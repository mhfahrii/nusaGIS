import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import { Blok } from '@/types/perkebunan';

interface PgError extends Error {
  code?: string;
  detail?: string;
}

// LEFT JOIN afdeling: blok pada kebun tanpa afdeling tetap ikut terbaca.
const SELECT_BLOK = `
  SELECT b.id, b.kebun_id, b.afdeling_id, b.kode_blok, b.nama_blok, b.komoditas, b.tahun_tanam,
         b.aktivitas_terakhir, TO_CHAR(b.tanggal_aktivitas_terakhir, 'YYYY-MM-DD') AS tanggal_aktivitas_terakhir,
         b.keterangan, b.dibuat_pada, a.nama_afdeling, k.nama_kebun
  FROM blok b
  JOIN kebun k ON k.id = b.kebun_id
  LEFT JOIN afdeling a ON a.id = b.afdeling_id`;

const RETURNING_BLOK =
  "RETURNING id, kebun_id, afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, aktivitas_terakhir, TO_CHAR(tanggal_aktivitas_terakhir, 'YYYY-MM-DD') AS tanggal_aktivitas_terakhir, keterangan, dibuat_pada";

function errorJson(message: string, status: number) {
  return NextResponse.json({ status: 'error', message }, { status });
}

function parsePositiveInt(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Menentukan pasangan (kebun_id, afdeling_id) yang sah.
 * Bila afdeling diisi, kebun mengikuti afdeling tersebut; bila kosong, blok langsung di bawah kebun.
 */
async function resolveWilayahBlok(
  kebunId: number | null,
  afdelingId: number | null
): Promise<{ kebunId: number; afdelingId: number | null } | { error: NextResponse }> {
  if (afdelingId) {
    const afd = await query<{ kebun_id: string }>('SELECT kebun_id FROM afdeling WHERE id = $1;', [afdelingId]);
    if (afd.rowCount === 0) {
      return { error: errorJson(`Afdeling dengan ID ${afdelingId} tidak ditemukan.`, 404) };
    }
    const afdKebunId = Number(afd.rows[0].kebun_id);
    if (kebunId && kebunId !== afdKebunId) {
      return { error: errorJson('Afdeling yang dipilih bukan milik kebun tersebut.', 400) };
    }
    return { kebunId: afdKebunId, afdelingId };
  }

  if (!kebunId) {
    return { error: errorJson('Field "kebun_id" wajib diisi bila blok tidak memiliki afdeling.', 400) };
  }
  const kebun = await query('SELECT id FROM kebun WHERE id = $1;', [kebunId]);
  if (kebun.rowCount === 0) {
    return { error: errorJson(`Kebun dengan ID ${kebunId} tidak ditemukan.`, 404) };
  }
  return { kebunId, afdelingId: null };
}

async function isKodeBlokTaken(kebunId: number, afdelingId: number | null, kode: string, excludeId = 0) {
  const dup = await query(
    `SELECT id FROM blok
     WHERE kebun_id = $1 AND afdeling_id IS NOT DISTINCT FROM $2 AND LOWER(kode_blok) = LOWER($3) AND id <> $4;`,
    [kebunId, afdelingId, kode, excludeId]
  );
  return (dup.rowCount ?? 0) > 0;
}

function parseTahunTanam(raw: unknown): number | null | 'invalid' {
  if (raw === null || raw === '') return null;
  const tahun = parseInt(String(raw), 10);
  return isNaN(tahun) || tahun < 1900 || tahun > 2100 ? 'invalid' : tahun;
}

function parseIsoDate(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === '') return null;
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : 'invalid';
}

const MSG_TAHUN = 'Field "tahun_tanam" harus berupa tahun yang valid (antara 1900 - 2100).';
const MSG_TANGGAL = 'Field "tanggal_aktivitas_terakhir" harus berformat YYYY-MM-DD.';
const MSG_KODE_GANDA = 'Kode blok sudah dipakai di afdeling ini (atau di kebun ini untuk blok tanpa afdeling).';

// GET /api/blok (opsional ?id=, ?kebun_id=, ?afdeling_id=)
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const filters: [string, string][] = [
      ['id', 'b.id'],
      ['kebun_id', 'b.kebun_id'],
      ['afdeling_id', 'b.afdeling_id'],
    ];

    const where: string[] = [];
    const params: number[] = [];
    for (const [param, column] of filters) {
      const raw = searchParams.get(param);
      if (raw === null) continue;
      const value = parsePositiveInt(raw);
      if (!value) return errorJson(`Parameter "${param}" harus berupa angka positif.`, 400);
      params.push(value);
      where.push(`${column} = $${params.length}`);
    }

    const res = await query<Blok>(
      `${SELECT_BLOK}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY k.nama_kebun ASC, a.nama_afdeling ASC NULLS FIRST, b.nama_blok ASC;`,
      params
    );

    if (searchParams.get('id')) {
      if (res.rowCount === 0) return errorJson(`Blok dengan ID ${params[0]} tidak ditemukan.`, 404);
      return NextResponse.json({ status: 'success', data: res.rows[0] });
    }

    return NextResponse.json({ status: 'success', total: res.rowCount, data: res.rows });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data blok.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}

// POST /api/blok  body: { kebun_id?, afdeling_id?, kode_blok, nama_blok, komoditas?, tahun_tanam?, keterangan? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { permission: 'edit_data' });
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return errorJson('Format JSON body tidak valid.', 400);

    const kode_blok = typeof body.kode_blok === 'string' ? body.kode_blok.trim() : '';
    const nama_blok = typeof body.nama_blok === 'string' ? body.nama_blok.trim() : '';
    const komoditas = typeof body.komoditas === 'string' ? body.komoditas.trim() || null : null;
    const aktivitas_terakhir = typeof body.aktivitas_terakhir === 'string' ? body.aktivitas_terakhir.trim() || null : null;
    const tanggal_aktivitas_terakhir =
      body.tanggal_aktivitas_terakhir === undefined ? null : parseIsoDate(body.tanggal_aktivitas_terakhir);
    const keterangan = typeof body.keterangan === 'string' ? body.keterangan.trim() || null : null;
    const tahun_tanam = body.tahun_tanam === undefined ? null : parseTahunTanam(body.tahun_tanam);

    if (tahun_tanam === 'invalid') return errorJson(MSG_TAHUN, 400);
    if (tanggal_aktivitas_terakhir === 'invalid') return errorJson(MSG_TANGGAL, 400);
    if (!kode_blok) return errorJson('Field "kode_blok" wajib diisi.', 400);
    if (!nama_blok) return errorJson('Field "nama_blok" wajib diisi.', 400);

    const hasAfdeling = body.afdeling_id !== undefined && body.afdeling_id !== null && body.afdeling_id !== '';
    const afdelingId = hasAfdeling ? parsePositiveInt(body.afdeling_id) : null;
    if (hasAfdeling && !afdelingId) return errorJson('Field "afdeling_id" harus berupa angka positif.', 400);

    const wilayah = await resolveWilayahBlok(parsePositiveInt(body.kebun_id), afdelingId);
    if ('error' in wilayah) return wilayah.error;

    if (await isKodeBlokTaken(wilayah.kebunId, wilayah.afdelingId, kode_blok)) {
      return errorJson(`${MSG_KODE_GANDA} (${kode_blok})`, 409);
    }

    const insertRes = await query<Blok>(
      `INSERT INTO blok (kebun_id, afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, aktivitas_terakhir, tanggal_aktivitas_terakhir, keterangan, dibuat_pada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ${RETURNING_BLOK};`,
      [
        wilayah.kebunId,
        wilayah.afdelingId,
        kode_blok,
        nama_blok,
        komoditas,
        tahun_tanam,
        aktivitas_terakhir,
        tanggal_aktivitas_terakhir,
        keterangan,
      ]
    );

    await catatAktivitas(
      auth.user.id,
      'tambah_blok',
      `Menambahkan blok "${nama_blok}" (${kode_blok}) pada kebun ID #${wilayah.kebunId}` +
        (wilayah.afdelingId ? `, afdeling ID #${wilayah.afdelingId}.` : ' (tanpa afdeling).')
    );

    return NextResponse.json(
      { status: 'success', message: 'Data blok berhasil ditambahkan.', data: insertRes.rows[0] },
      { status: 201 }
    );
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') return errorJson(MSG_KODE_GANDA, 409);
    if (pgErr.code === '23503') return errorJson('Kebun atau afdeling yang dirujuk tidak valid.', 400);
    return NextResponse.json(
      { status: 'error', message: 'Gagal menambahkan data blok.', detail: safeErrorDetail(pgErr) },
      { status: 500 }
    );
  }
}

// PATCH /api/blok  body: { id, ...field yang diubah }. afdeling_id: null memindahkan blok ke "tanpa afdeling".
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req, { permission: 'edit_data' });
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return errorJson('Format JSON body tidak valid.', 400);

    const id = parsePositiveInt(body.id);
    if (!id) return errorJson('Field "id" wajib diisi dengan angka positif.', 400);

    const existingRes = await query<Blok>('SELECT * FROM blok WHERE id = $1;', [id]);
    if (existingRes.rowCount === 0) return errorJson(`Blok dengan ID ${id} tidak ditemukan.`, 404);
    const current = existingRes.rows[0];

    const updates: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    let targetKebunId = Number(current.kebun_id);
    let targetAfdelingId = current.afdeling_id ? Number(current.afdeling_id) : null;
    const wilayahChanged = body.kebun_id !== undefined || body.afdeling_id !== undefined;

    if (wilayahChanged) {
      let afdelingId = targetAfdelingId;
      if (body.afdeling_id !== undefined) {
        const clearAfdeling = body.afdeling_id === null || body.afdeling_id === '';
        afdelingId = clearAfdeling ? null : parsePositiveInt(body.afdeling_id);
        if (!clearAfdeling && !afdelingId) return errorJson('Field "afdeling_id" harus berupa angka positif.', 400);
      }
      let kebunId: number | null = targetKebunId;
      if (body.kebun_id !== undefined) {
        kebunId = parsePositiveInt(body.kebun_id);
        if (!kebunId) return errorJson('Field "kebun_id" harus berupa angka positif.', 400);
        // Pindah kebun tanpa menyebut afdeling baru: afdeling lama pasti milik kebun lama, jadi dilepas.
        if (body.afdeling_id === undefined && kebunId !== targetKebunId) afdelingId = null;
      }

      const wilayah = await resolveWilayahBlok(kebunId, afdelingId);
      if ('error' in wilayah) return wilayah.error;
      targetKebunId = wilayah.kebunId;
      targetAfdelingId = wilayah.afdelingId;
      set('kebun_id', targetKebunId);
      set('afdeling_id', targetAfdelingId);
    }

    let targetKode = current.kode_blok;
    if (body.kode_blok !== undefined) {
      targetKode = typeof body.kode_blok === 'string' ? body.kode_blok.trim() : '';
      if (!targetKode) return errorJson('Field "kode_blok" tidak boleh kosong.', 400);
      set('kode_blok', targetKode);
    }

    if ((wilayahChanged || body.kode_blok !== undefined) &&
        (await isKodeBlokTaken(targetKebunId, targetAfdelingId, targetKode, id))) {
      return errorJson(`${MSG_KODE_GANDA} (${targetKode})`, 409);
    }

    if (body.nama_blok !== undefined) {
      const nama = typeof body.nama_blok === 'string' ? body.nama_blok.trim() : '';
      if (!nama) return errorJson('Field "nama_blok" tidak boleh kosong.', 400);
      set('nama_blok', nama);
    }

    if (body.komoditas !== undefined) {
      set('komoditas', typeof body.komoditas === 'string' ? body.komoditas.trim() : null);
    }

    if (body.tahun_tanam !== undefined) {
      const tahun = parseTahunTanam(body.tahun_tanam);
      if (tahun === 'invalid') return errorJson(MSG_TAHUN, 400);
      set('tahun_tanam', tahun);
    }

    if (body.aktivitas_terakhir !== undefined) {
      set('aktivitas_terakhir', typeof body.aktivitas_terakhir === 'string' ? body.aktivitas_terakhir.trim() || null : null);
    }

    if (body.tanggal_aktivitas_terakhir !== undefined) {
      const tgl = parseIsoDate(body.tanggal_aktivitas_terakhir);
      if (tgl === 'invalid') return errorJson(MSG_TANGGAL, 400);
      set('tanggal_aktivitas_terakhir', tgl);
    }

    if (body.keterangan !== undefined) {
      set('keterangan', typeof body.keterangan === 'string' ? body.keterangan.trim() : null);
    }

    if (updates.length === 0) return errorJson('Tidak ada field yang diberikan untuk diperbarui.', 400);

    values.push(id);
    const updateRes = await query<Blok>(
      `UPDATE blok SET ${updates.join(', ')} WHERE id = $${values.length} ${RETURNING_BLOK};`,
      values
    );
    const updatedRow = updateRes.rows[0];

    await catatAktivitas(
      auth.user.id,
      'ubah_blok',
      `Memperbarui blok "${updatedRow.nama_blok}" (${updatedRow.kode_blok}).`
    );

    return NextResponse.json({ status: 'success', message: 'Data blok berhasil diperbarui.', data: updatedRow });
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') return errorJson(MSG_KODE_GANDA, 409);
    if (pgErr.code === '23503') return errorJson('Kebun atau afdeling yang dirujuk tidak valid.', 400);
    return NextResponse.json(
      { status: 'error', message: 'Gagal memperbarui data blok.', detail: safeErrorDetail(pgErr) },
      { status: 500 }
    );
  }
}

// DELETE /api/blok?id={id}
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req, { permission: 'hapus_data', requireJson: false });
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');

    if (!idParam) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter query "id" wajib disertakan.' },
        { status: 400 }
      );
    }

    const id = parseInt(idParam, 10);
    if (isNaN(id) || id <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter "id" harus berupa angka positif.' },
        { status: 400 }
      );
    }

    const delRes = await query<Blok>(
      'DELETE FROM blok WHERE id = $1 RETURNING id, kode_blok, nama_blok;',
      [id]
    );

    if (delRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Blok dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    await catatAktivitas(
      auth.user.id,
      'hapus_blok',
      `Menghapus blok "${delRes.rows[0].nama_blok}" (${delRes.rows[0].kode_blok}).`
    );

    return NextResponse.json({
      status: 'success',
      message: `Blok "${delRes.rows[0].nama_blok}" berhasil dihapus.`,
      data: delRes.rows[0],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus data blok.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}
