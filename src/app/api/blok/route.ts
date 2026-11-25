import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import { Blok, Afdeling } from '@/types/perkebunan';

interface PgError extends Error {
  code?: string;
  detail?: string;
}

// GET /api/blok (opsional ?afdeling_id={id} atau ?id={id})
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const afdelingIdParam = searchParams.get('afdeling_id');

    if (idParam) {
      const id = parseInt(idParam, 10);
      if (isNaN(id) || id <= 0) {
        return NextResponse.json(
          { status: 'error', message: 'Parameter "id" harus berupa angka positif.' },
          { status: 400 }
        );
      }

      const res = await query<Blok>(
        `SELECT b.id, b.afdeling_id, b.kode_blok, b.nama_blok, b.komoditas, b.tahun_tanam, b.keterangan, b.dibuat_pada,
                a.nama_afdeling, k.nama_kebun
         FROM blok b
         JOIN afdeling a ON a.id = b.afdeling_id
         JOIN kebun k ON k.id = a.kebun_id
         WHERE b.id = $1;`,
        [id]
      );

      if (res.rowCount === 0) {
        return NextResponse.json(
          { status: 'error', message: `Blok dengan ID ${id} tidak ditemukan.` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        status: 'success',
        data: res.rows[0],
      });
    }

    if (afdelingIdParam) {
      const afdelingId = parseInt(afdelingIdParam, 10);
      if (isNaN(afdelingId) || afdelingId <= 0) {
        return NextResponse.json(
          { status: 'error', message: 'Parameter "afdeling_id" harus berupa angka positif.' },
          { status: 400 }
        );
      }

      // Validasi afdeling
      const afdCheck = await query<Afdeling>('SELECT id FROM afdeling WHERE id = $1;', [afdelingId]);
      if (afdCheck.rowCount === 0) {
        return NextResponse.json(
          { status: 'error', message: `Afdeling dengan ID ${afdelingId} tidak ditemukan.` },
          { status: 404 }
        );
      }

      const res = await query<Blok>(
        `SELECT b.id, b.afdeling_id, b.kode_blok, b.nama_blok, b.komoditas, b.tahun_tanam, b.keterangan, b.dibuat_pada,
                a.nama_afdeling, k.nama_kebun
         FROM blok b
         JOIN afdeling a ON a.id = b.afdeling_id
         JOIN kebun k ON k.id = a.kebun_id
         WHERE b.afdeling_id = $1
         ORDER BY b.nama_blok ASC;`,
        [afdelingId]
      );

      return NextResponse.json({
        status: 'success',
        afdeling_id: afdelingId,
        total: res.rowCount,
        data: res.rows,
      });
    }

    const res = await query<Blok>(
      `SELECT b.id, b.afdeling_id, b.kode_blok, b.nama_blok, b.komoditas, b.tahun_tanam, b.keterangan, b.dibuat_pada,
              a.nama_afdeling, k.nama_kebun
       FROM blok b
       JOIN afdeling a ON a.id = b.afdeling_id
       JOIN kebun k ON k.id = a.kebun_id
       ORDER BY k.nama_kebun ASC, a.nama_afdeling ASC, b.nama_blok ASC;`
    );

    return NextResponse.json({
      status: 'success',
      total: res.rowCount,
      data: res.rows,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data blok.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}

// POST /api/blok
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { permission: 'edit_data' });
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { status: 'error', message: 'Format JSON body tidak valid.' },
        { status: 400 }
      );
    }

    const afdeling_id = parseInt(String(body.afdeling_id), 10);
    const kode_blok = typeof body.kode_blok === 'string' ? body.kode_blok.trim() : '';
    const nama_blok = typeof body.nama_blok === 'string' ? body.nama_blok.trim() : '';
    const komoditas = typeof body.komoditas === 'string' ? body.komoditas.trim() : null;
    const keterangan = typeof body.keterangan === 'string' ? body.keterangan.trim() : null;

    let tahun_tanam: number | null = null;
    if (body.tahun_tanam !== undefined && body.tahun_tanam !== null && body.tahun_tanam !== '') {
      tahun_tanam = parseInt(String(body.tahun_tanam), 10);
      if (isNaN(tahun_tanam) || tahun_tanam < 1900 || tahun_tanam > 2100) {
        return NextResponse.json(
          { status: 'error', message: 'Field "tahun_tanam" harus berupa tahun yang valid (antara 1900 - 2100).' },
          { status: 400 }
        );
      }
    }

    if (isNaN(afdeling_id) || afdeling_id <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Field "afdeling_id" wajib berupa angka positif.' },
        { status: 400 }
      );
    }

    if (!kode_blok) {
      return NextResponse.json(
        { status: 'error', message: 'Field "kode_blok" wajib diisi.' },
        { status: 400 }
      );
    }

    if (!nama_blok) {
      return NextResponse.json(
        { status: 'error', message: 'Field "nama_blok" wajib diisi.' },
        { status: 400 }
      );
    }

    // 1. Validasi Foreign Key (afdeling_id)
    const afdCheck = await query<Afdeling>('SELECT id FROM afdeling WHERE id = $1;', [afdeling_id]);
    if (afdCheck.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Afdeling dengan ID ${afdeling_id} tidak ditemukan (Foreign Key tidak valid).` },
        { status: 404 }
      );
    }

    // 2. Validasi Kode Blok Unik dalam satu afdeling
    const checkDup = await query<Blok>(
      'SELECT id FROM blok WHERE afdeling_id = $1 AND LOWER(kode_blok) = LOWER($2);',
      [afdeling_id, kode_blok]
    );

    if (checkDup.rowCount && checkDup.rowCount > 0) {
      return NextResponse.json(
        {
          status: 'error',
          message: `Kode blok "${kode_blok}" sudah digunakan pada afdeling ini (duplikasi kode dalam satu afdeling).`,
        },
        { status: 409 }
      );
    }

    const insertRes = await query<Blok>(
      `INSERT INTO blok (afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, keterangan, dibuat_pada)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, keterangan, dibuat_pada;`,
      [afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, keterangan]
    );

    await catatAktivitas(
      auth.user.id,
      'tambah_blok',
      `Menambahkan blok "${nama_blok}" (${kode_blok}) pada afdeling ID #${afdeling_id}.`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: 'Data blok berhasil ditambahkan.',
        data: insertRes.rows[0],
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') {
      return NextResponse.json(
        { status: 'error', message: 'Kode blok sudah terdaftar pada afdeling ini (konflik data unik).' },
        { status: 409 }
      );
    }
    if (pgErr.code === '23503') {
      return NextResponse.json(
        { status: 'error', message: 'Afdeling yang dirujuk tidak ditemukan (pelanggaran Foreign Key).' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { status: 'error', message: 'Gagal menambahkan data blok.', detail: safeErrorDetail(pgErr) },
      { status: 500 }
    );
  }
}

// PATCH /api/blok
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req, { permission: 'edit_data' });
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { status: 'error', message: 'Format JSON body tidak valid.' },
        { status: 400 }
      );
    }

    const id = parseInt(String(body.id), 10);
    if (isNaN(id) || id <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Field "id" wajib diisi dengan angka positif.' },
        { status: 400 }
      );
    }

    // Pastikan blok ada
    const existingRes = await query<Blok>('SELECT * FROM blok WHERE id = $1;', [id]);
    if (existingRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Blok dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }
    const current = existingRes.rows[0];

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    let targetAfdelingId = Number(current.afdeling_id);
    if (body.afdeling_id !== undefined) {
      const newAfdelingId = parseInt(String(body.afdeling_id), 10);
      if (isNaN(newAfdelingId) || newAfdelingId <= 0) {
        return NextResponse.json(
          { status: 'error', message: 'Field "afdeling_id" harus berupa angka positif.' },
          { status: 400 }
        );
      }
      const afdCheck = await query<Afdeling>('SELECT id FROM afdeling WHERE id = $1;', [newAfdelingId]);
      if (afdCheck.rowCount === 0) {
        return NextResponse.json(
          { status: 'error', message: `Afdeling dengan ID ${newAfdelingId} tidak ditemukan.` },
          { status: 404 }
        );
      }
      targetAfdelingId = newAfdelingId;
      updates.push(`afdeling_id = $${paramIndex++}`);
      values.push(newAfdelingId);
    }

    if (body.kode_blok !== undefined) {
      const kode = typeof body.kode_blok === 'string' ? body.kode_blok.trim() : '';
      if (!kode) {
        return NextResponse.json(
          { status: 'error', message: 'Field "kode_blok" tidak boleh kosong.' },
          { status: 400 }
        );
      }

      // Cek keunikan kode_blok dalam afdeling target
      const checkDup = await query<Blok>(
        'SELECT id FROM blok WHERE afdeling_id = $1 AND LOWER(kode_blok) = LOWER($2) AND id != $3;',
        [targetAfdelingId, kode, id]
      );
      if (checkDup.rowCount && checkDup.rowCount > 0) {
        return NextResponse.json(
          { status: 'error', message: `Kode blok "${kode}" sudah digunakan pada afdeling tersebut.` },
          { status: 409 }
        );
      }

      updates.push(`kode_blok = $${paramIndex++}`);
      values.push(kode);
    }

    if (body.nama_blok !== undefined) {
      const nama = typeof body.nama_blok === 'string' ? body.nama_blok.trim() : '';
      if (!nama) {
        return NextResponse.json(
          { status: 'error', message: 'Field "nama_blok" tidak boleh kosong.' },
          { status: 400 }
        );
      }
      updates.push(`nama_blok = $${paramIndex++}`);
      values.push(nama);
    }

    if (body.komoditas !== undefined) {
      updates.push(`komoditas = $${paramIndex++}`);
      values.push(typeof body.komoditas === 'string' ? body.komoditas.trim() : null);
    }

    if (body.tahun_tanam !== undefined) {
      if (body.tahun_tanam === null || body.tahun_tanam === '') {
        updates.push(`tahun_tanam = $${paramIndex++}`);
        values.push(null);
      } else {
        const tahun = parseInt(String(body.tahun_tanam), 10);
        if (isNaN(tahun) || tahun < 1900 || tahun > 2100) {
          return NextResponse.json(
            { status: 'error', message: 'Field "tahun_tanam" harus berupa tahun yang valid (antara 1900 - 2100).' },
            { status: 400 }
          );
        }
        updates.push(`tahun_tanam = $${paramIndex++}`);
        values.push(tahun);
      }
    }

    if (body.keterangan !== undefined) {
      updates.push(`keterangan = $${paramIndex++}`);
      values.push(typeof body.keterangan === 'string' ? body.keterangan.trim() : null);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Tidak ada field yang diberikan untuk diperbarui.' },
        { status: 400 }
      );
    }

    values.push(id);
    const updateSql = `
      UPDATE blok
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, keterangan, dibuat_pada;
    `;

    const updateRes = await query<Blok>(updateSql, values);
    const updatedRow = updateRes.rows[0];

    await catatAktivitas(
      auth.user.id,
      'ubah_blok',
      `Memperbarui blok "${updatedRow.nama_blok}" (${updatedRow.kode_blok}).`
    );

    return NextResponse.json({
      status: 'success',
      message: 'Data blok berhasil diperbarui.',
      data: updatedRow,
    });
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') {
      return NextResponse.json(
        { status: 'error', message: 'Kode blok sudah terdaftar pada afdeling ini (konflik data unik).' },
        { status: 409 }
      );
    }
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

