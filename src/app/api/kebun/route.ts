import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { Kebun } from '@/types/perkebunan';

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
        'SELECT id, kode_kebun, nama_kebun, wilayah, komoditas, keterangan, dibuat_pada FROM kebun WHERE id = $1;',
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
      'SELECT id, kode_kebun, nama_kebun, wilayah, komoditas, keterangan, dibuat_pada FROM kebun ORDER BY nama_kebun ASC;'
    );

    return NextResponse.json({
      status: 'success',
      total: res.rowCount,
      data: res.rows,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data kebun.', detail: error.message },
      { status: 500 }
    );
  }
}

// POST /api/kebun
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
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
    const wilayah = typeof body.wilayah === 'string' ? body.wilayah.trim() : null;
    const komoditas = typeof body.komoditas === 'string' ? body.komoditas.trim() : null;
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
      `INSERT INTO kebun (kode_kebun, nama_kebun, wilayah, komoditas, keterangan, dibuat_pada)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, kode_kebun, nama_kebun, wilayah, komoditas, keterangan, dibuat_pada;`,
      [kode_kebun, nama_kebun, wilayah, komoditas, keterangan]
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
      { status: 'error', message: 'Gagal menambahkan data kebun.', detail: pgErr.message },
      { status: 500 }
    );
  }
}

// PATCH /api/kebun
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
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

    if (body.wilayah !== undefined) {
      updates.push(`wilayah = $${paramIndex++}`);
      values.push(typeof body.wilayah === 'string' ? body.wilayah.trim() : null);
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
      RETURNING id, kode_kebun, nama_kebun, wilayah, komoditas, keterangan, dibuat_pada;
    `;

    const updateRes = await query<Kebun>(updateSql, values);

    return NextResponse.json({
      status: 'success',
      message: 'Data kebun berhasil diperbarui.',
      data: updateRes.rows[0],
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
      { status: 'error', message: 'Gagal memperbarui data kebun.', detail: pgErr.message },
      { status: 500 }
    );
  }
}

// DELETE /api/kebun?id={id}
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
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

    return NextResponse.json({
      status: 'success',
      message: `Kebun "${delRes.rows[0].nama_kebun}" berhasil dihapus.`,
      data: delRes.rows[0],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus data kebun.', detail: error.message },
      { status: 500 }
    );
  }
}

