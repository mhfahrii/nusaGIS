import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import { Kebun } from '@/types/perkebunan';
import { normalizePerusahaanName, inferRpnEntityFromContext } from '@/lib/gis/rpnEntities';
import { parseWilayahHierarchy } from '@/lib/gis/wilayah';

interface PgError extends Error {
  code?: string;
  detail?: string;
}

// GET /api/kebun (opsional ?id={id})
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');

    if (idParam) {
      const id = parseInt(idParam, 10);
      if (isNaN(id) || id <= 0) {
        return NextResponse.json(
          { status: 'error', message: 'Parameter ID harus berupa angka positif.' },
          { status: 400 }
        );
      }

      const res = await query<Kebun>(
        'SELECT id, kode_kebun, nama_kebun, perusahaan, wilayah, provinsi, kabupaten_kota, komoditas, keterangan, dibuat_pada FROM kebun WHERE id = $1;',
        [id]
      );

      if (res.rowCount === 0) {
        return NextResponse.json(
          { status: 'error', message: `Kebun dengan ID ${id} tidak ditemukan.` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        status: 'success',
        data: res.rows[0],
      });
    }

    const res = await query<Kebun>(
      `SELECT k.id, k.kode_kebun, k.nama_kebun, k.perusahaan, k.wilayah, k.provinsi, k.kabupaten_kota, k.komoditas, k.keterangan, k.dibuat_pada
       FROM public.kebun k
       WHERE EXISTS (
         SELECT 1 FROM public.layer_peta lp
         WHERE lp.kebun_id = k.id AND COALESCE(lp.is_deleted, FALSE) = FALSE
       ) OR NOT EXISTS (
         SELECT 1 FROM public.layer_peta lp
         WHERE lp.kebun_id = k.id
       )
       ORDER BY k.nama_kebun ASC;`
    );

    return NextResponse.json({
      status: 'success',
      total: res.rowCount,
      data: res.rows,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data kebun.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}

// POST /api/kebun
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

    const kode_kebun = typeof body.kode_kebun === 'string' ? body.kode_kebun.trim() : '';
    const nama_kebun = typeof body.nama_kebun === 'string' ? body.nama_kebun.trim() : '';
    let wilayah = typeof body.wilayah === 'string' ? body.wilayah.trim() : null;
    let provinsi = typeof body.provinsi === 'string' ? body.provinsi.trim() : null;
    let kabupaten_kota = typeof body.kabupaten_kota === 'string' ? body.kabupaten_kota.trim() : null;

    if (!provinsi || !kabupaten_kota) {
      const parsed = parseWilayahHierarchy(wilayah);
      if (!provinsi && parsed.provinsi) provinsi = parsed.provinsi;
      if (!kabupaten_kota && parsed.kabupatenKota) kabupaten_kota = parsed.kabupatenKota;
    }
    if (!wilayah && (provinsi || kabupaten_kota)) {
      wilayah = kabupaten_kota && provinsi ? `${kabupaten_kota}, ${provinsi}` : (provinsi || kabupaten_kota);
    }

    const komoditas = typeof body.komoditas === 'string' ? body.komoditas.trim() : null;
    const perusahaan = typeof body.perusahaan === 'string' && body.perusahaan.trim()
      ? normalizePerusahaanName(body.perusahaan)
      : inferRpnEntityFromContext({ namaKebun: nama_kebun, wilayah, komoditas });
    const keterangan = typeof body.keterangan === 'string' ? body.keterangan.trim() : null;

    if (!kode_kebun) {
      return NextResponse.json(
        { status: 'error', message: 'Field "kode_kebun" wajib diisi.' },
        { status: 400 }
      );
    }

    if (!nama_kebun) {
      return NextResponse.json(
        { status: 'error', message: 'Field "nama_kebun" wajib diisi.' },
        { status: 400 }
      );
    }

    // Cek duplikasi kode_kebun
    const checkDup = await query<Kebun>(
      'SELECT id FROM kebun WHERE LOWER(kode_kebun) = LOWER($1);',
      [kode_kebun]
    );

    if (checkDup.rowCount && checkDup.rowCount > 0) {
      return NextResponse.json(
        { status: 'error', message: `Kode kebun "${kode_kebun}" sudah digunakan.` },
        { status: 409 }
      );
    }

    const insertRes = await query<Kebun>(
      `INSERT INTO kebun (kode_kebun, nama_kebun, perusahaan, wilayah, provinsi, kabupaten_kota, komoditas, keterangan, dibuat_pada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, kode_kebun, nama_kebun, perusahaan, wilayah, provinsi, kabupaten_kota, komoditas, keterangan, dibuat_pada;`,
      [kode_kebun, nama_kebun, perusahaan, wilayah, provinsi, kabupaten_kota, komoditas, keterangan]
    );

    await catatAktivitas(
      auth.user.id,
      'tambah_kebun',
      `Menambahkan unit kebun "${nama_kebun}" (${kode_kebun}) di wilayah ${wilayah || '-'}.`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: 'Data kebun berhasil ditambahkan.',
        data: insertRes.rows[0],
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') {
      return NextResponse.json(
        { status: 'error', message: 'Kode kebun sudah terdaftar (konflik data unik).' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { status: 'error', message: 'Gagal menambahkan data kebun.', detail: safeErrorDetail(pgErr) },
      { status: 500 }
    );
  }
}

// PATCH /api/kebun
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

    // Pastikan data kebun ada
    const existing = await query<Kebun>('SELECT * FROM kebun WHERE id = $1;', [id]);
    if (existing.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Kebun dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.kode_kebun !== undefined) {
      const kode = typeof body.kode_kebun === 'string' ? body.kode_kebun.trim() : '';
      if (!kode) {
        return NextResponse.json(
          { status: 'error', message: 'Field "kode_kebun" tidak boleh kosong.' },
          { status: 400 }
        );
      }
      // Cek duplikasi kode_kebun di entri lain
      const checkDup = await query<Kebun>(
        'SELECT id FROM kebun WHERE LOWER(kode_kebun) = LOWER($1) AND id != $2;',
        [kode, id]
      );
      if (checkDup.rowCount && checkDup.rowCount > 0) {
        return NextResponse.json(
          { status: 'error', message: `Kode kebun "${kode}" sudah digunakan oleh kebun lain.` },
          { status: 409 }
        );
      }
      updates.push(`kode_kebun = $${paramIndex++}`);
      values.push(kode);
    }

    if (body.nama_kebun !== undefined) {
      const nama = typeof body.nama_kebun === 'string' ? body.nama_kebun.trim() : '';
      if (!nama) {
        return NextResponse.json(
          { status: 'error', message: 'Field "nama_kebun" tidak boleh kosong.' },
          { status: 400 }
        );
      }
      updates.push(`nama_kebun = $${paramIndex++}`);
      values.push(nama);
    }

    if (body.perusahaan !== undefined) {
      updates.push(`perusahaan = $${paramIndex++}`);
      values.push(typeof body.perusahaan === 'string' ? body.perusahaan.trim() : null);
    }

    if (body.wilayah !== undefined || body.provinsi !== undefined || body.kabupaten_kota !== undefined) {
      const rawWil = typeof body.wilayah === 'string' ? body.wilayah.trim() : null;
      let prov = typeof body.provinsi === 'string' ? body.provinsi.trim() : null;
      let kab = typeof body.kabupaten_kota === 'string' ? body.kabupaten_kota.trim() : null;

      if (!prov || !kab) {
        const parsed = parseWilayahHierarchy(rawWil);
        if (!prov && parsed.provinsi) prov = parsed.provinsi;
        if (!kab && parsed.kabupatenKota) kab = parsed.kabupatenKota;
      }
      const fullWil = rawWil || (kab && prov ? `${kab}, ${prov}` : (prov || kab));

      updates.push(`wilayah = $${paramIndex++}`);
      values.push(fullWil);
      updates.push(`provinsi = $${paramIndex++}`);
      values.push(prov);
      updates.push(`kabupaten_kota = $${paramIndex++}`);
      values.push(kab);
    }

    if (body.komoditas !== undefined) {
      updates.push(`komoditas = $${paramIndex++}`);
      values.push(typeof body.komoditas === 'string' ? body.komoditas.trim() : null);
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
      UPDATE kebun 
      SET ${updates.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, kode_kebun, nama_kebun, perusahaan, wilayah, provinsi, kabupaten_kota, komoditas, keterangan, dibuat_pada;
    `;

    const updateRes = await query<Kebun>(updateSql, values);
    const updatedRow = updateRes.rows[0];

    await catatAktivitas(
      auth.user.id,
      'ubah_kebun',
      `Memperbarui data unit kebun "${updatedRow.nama_kebun}" (${updatedRow.kode_kebun}).`
    );

    return NextResponse.json({
      status: 'success',
      message: 'Data kebun berhasil diperbarui.',
      data: updatedRow,
    });
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') {
      return NextResponse.json(
        { status: 'error', message: 'Kode kebun sudah terdaftar (konflik data unik).' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { status: 'error', message: 'Gagal memperbarui data kebun.', detail: safeErrorDetail(pgErr) },
      { status: 500 }
    );
  }
}

// DELETE /api/kebun?id={id}
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

    const delRes = await query<Kebun>(
      'DELETE FROM kebun WHERE id = $1 RETURNING id, kode_kebun, nama_kebun;',
      [id]
    );

    if (delRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Kebun dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    await catatAktivitas(
      auth.user.id,
      'hapus_kebun',
      `Menghapus unit kebun "${delRes.rows[0].nama_kebun}" (${delRes.rows[0].kode_kebun}).`
    );

    return NextResponse.json({
      status: 'success',
      message: `Kebun "${delRes.rows[0].nama_kebun}" berhasil dihapus.`,
      data: delRes.rows[0],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus data kebun.', detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}

