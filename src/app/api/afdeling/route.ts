import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { Afdeling, Kebun } from '@/types/perkebunan';

interface PgError extends Error {
  code?: string;
  detail?: string;
}

// GET /api/afdeling (opsional ?kebun_id={id} atau ?id={id})
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const kebunIdParam = searchParams.get('kebun_id');

    if (idParam) {
      const id = parseInt(idParam, 10);
      if (isNaN(id) || id <= 0) {
        return NextResponse.json(
          { status: 'error', message: 'Parameter "id" harus berupa angka positif.' },
          { status: 400 }
        );
      }

      const res = await query<Afdeling>(
        `SELECT a.id, a.kebun_id, a.kode_afdeling, a.nama_afdeling, a.keterangan, a.dibuat_pada,
                k.nama_kebun
         FROM afdeling a
         JOIN kebun k ON k.id = a.kebun_id
         WHERE a.id = $1;`,
        [id]
      );

      if (res.rowCount === 0) {
        return NextResponse.json(
          { status: 'error', message: `Afdeling dengan ID ${id} tidak ditemukan.` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        status: 'success',
        data: res.rows[0],
      });
    }

    if (kebunIdParam) {
      const kebunId = parseInt(kebunIdParam, 10);
      if (isNaN(kebunId) || kebunId <= 0) {
        return NextResponse.json(
          { status: 'error', message: 'Parameter "kebun_id" harus berupa angka positif.' },
          { status: 400 }
        );
      }

      // Validasi keberadaan kebun
      const kebunCheck = await query<Kebun>('SELECT id FROM kebun WHERE id = $1;', [kebunId]);
      if (kebunCheck.rowCount === 0) {
        return NextResponse.json(
          { status: 'error', message: `Kebun dengan ID ${kebunId} tidak ditemukan.` },
          { status: 404 }
        );
      }

      const res = await query<Afdeling>(
        `SELECT a.id, a.kebun_id, a.kode_afdeling, a.nama_afdeling, a.keterangan, a.dibuat_pada,
                k.nama_kebun
         FROM afdeling a
         JOIN kebun k ON k.id = a.kebun_id
         WHERE a.kebun_id = $1
         ORDER BY a.nama_afdeling ASC;`,
        [kebunId]
      );

      return NextResponse.json({
        status: 'success',
        kebun_id: kebunId,
        total: res.rowCount,
        data: res.rows,
      });
    }

    const res = await query<Afdeling>(
      `SELECT a.id, a.kebun_id, a.kode_afdeling, a.nama_afdeling, a.keterangan, a.dibuat_pada,
              k.nama_kebun
       FROM afdeling a
       JOIN kebun k ON k.id = a.kebun_id
       ORDER BY k.nama_kebun ASC, a.nama_afdeling ASC;`
    );

    return NextResponse.json({
      status: 'success',
      total: res.rowCount,
      data: res.rows,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal mengambil data afdeling.', detail: error.message },
      { status: 500 }
    );
  }
}

// POST /api/afdeling
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

    const kebun_id = parseInt(String(body.kebun_id), 10);
    const kode_afdeling = typeof body.kode_afdeling === 'string' ? body.kode_afdeling.trim() : '';
    const nama_afdeling = typeof body.nama_afdeling === 'string' ? body.nama_afdeling.trim() : '';
    const keterangan = typeof body.keterangan === 'string' ? body.keterangan.trim() : null;

    if (isNaN(kebun_id) || kebun_id <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Field "kebun_id" wajib berupa angka positif.' },
        { status: 400 }
      );
    }

    if (!kode_afdeling) {
      return NextResponse.json(
        { status: 'error', message: 'Field "kode_afdeling" wajib diisi.' },
        { status: 400 }
      );
    }

    if (!nama_afdeling) {
      return NextResponse.json(
        { status: 'error', message: 'Field "nama_afdeling" wajib diisi.' },
        { status: 400 }
      );
    }

    // 1. Validasi Foreign Key (kebun_id)
    const kebunCheck = await query<Kebun>('SELECT id FROM kebun WHERE id = $1;', [kebun_id]);
    if (kebunCheck.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Kebun dengan ID ${kebun_id} tidak ditemukan (Foreign Key tidak valid).` },
        { status: 404 }
      );
    }

    // 2. Validasi Kode Afdeling Unik dalam satu kebun
    const checkDup = await query<Afdeling>(
      'SELECT id FROM afdeling WHERE kebun_id = $1 AND LOWER(kode_afdeling) = LOWER($2);',
      [kebun_id, kode_afdeling]
    );

    if (checkDup.rowCount && checkDup.rowCount > 0) {
      return NextResponse.json(
        {
          status: 'error',
          message: `Kode afdeling "${kode_afdeling}" sudah digunakan pada kebun ini (duplikasi kode dalam satu kebun).`,
        },
        { status: 409 }
      );
    }

    const insertRes = await query<Afdeling>(
      `INSERT INTO afdeling (kebun_id, kode_afdeling, nama_afdeling, keterangan, dibuat_pada)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, kebun_id, kode_afdeling, nama_afdeling, keterangan, dibuat_pada;`,
      [kebun_id, kode_afdeling, nama_afdeling, keterangan]
    );

    return NextResponse.json(
      {
        status: 'success',
        message: 'Data afdeling berhasil ditambahkan.',
        data: insertRes.rows[0],
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') {
      return NextResponse.json(
        { status: 'error', message: 'Kode afdeling sudah terdaftar pada kebun ini (konflik data unik).' },
        { status: 409 }
      );
    }
    if (pgErr.code === '23503') {
      return NextResponse.json(
        { status: 'error', message: 'Kebun yang dirujuk tidak ditemukan (pelanggaran Foreign Key).' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { status: 'error', message: 'Gagal menambahkan data afdeling.', detail: pgErr.message },
      { status: 500 }
    );
  }
}

// PATCH /api/afdeling
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

    // Pastikan afdeling ada
    const existingRes = await query<Afdeling>('SELECT * FROM afdeling WHERE id = $1;', [id]);
    if (existingRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Afdeling dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }
    const current = existingRes.rows[0];

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    let targetKebunId = Number(current.kebun_id);
    if (body.kebun_id !== undefined) {
      const newKebunId = parseInt(String(body.kebun_id), 10);
      if (isNaN(newKebunId) || newKebunId <= 0) {
        return NextResponse.json(
          { status: 'error', message: 'Field "kebun_id" harus berupa angka positif.' },
          { status: 400 }
        );
      }
      const kebunCheck = await query<Kebun>('SELECT id FROM kebun WHERE id = $1;', [newKebunId]);
      if (kebunCheck.rowCount === 0) {
        return NextResponse.json(
          { status: 'error', message: `Kebun dengan ID ${newKebunId} tidak ditemukan.` },
          { status: 404 }
        );
      }
      targetKebunId = newKebunId;
      updates.push(`kebun_id = $${paramIndex++}`);
      values.push(newKebunId);
    }

    if (body.kode_afdeling !== undefined) {
      const kode = typeof body.kode_afdeling === 'string' ? body.kode_afdeling.trim() : '';
      if (!kode) {
        return NextResponse.json(
          { status: 'error', message: 'Field "kode_afdeling" tidak boleh kosong.' },
          { status: 400 }
        );
      }

      // Cek keunikan kode afdeling dalam target kebun
      const checkDup = await query<Afdeling>(
        'SELECT id FROM afdeling WHERE kebun_id = $1 AND LOWER(kode_afdeling) = LOWER($2) AND id != $3;',
        [targetKebunId, kode, id]
      );
      if (checkDup.rowCount && checkDup.rowCount > 0) {
        return NextResponse.json(
          { status: 'error', message: `Kode afdeling "${kode}" sudah digunakan pada kebun tersebut.` },
          { status: 409 }
        );
      }

      updates.push(`kode_afdeling = $${paramIndex++}`);
      values.push(kode);
    }

    if (body.nama_afdeling !== undefined) {
      const nama = typeof body.nama_afdeling === 'string' ? body.nama_afdeling.trim() : '';
      if (!nama) {
        return NextResponse.json(
          { status: 'error', message: 'Field "nama_afdeling" tidak boleh kosong.' },
          { status: 400 }
        );
      }
      updates.push(`nama_afdeling = $${paramIndex++}`);
      values.push(nama);
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
      UPDATE afdeling
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, kebun_id, kode_afdeling, nama_afdeling, keterangan, dibuat_pada;
    `;

    const updateRes = await query<Afdeling>(updateSql, values);

    return NextResponse.json({
      status: 'success',
      message: 'Data afdeling berhasil diperbarui.',
      data: updateRes.rows[0],
    });
  } catch (err: unknown) {
    const pgErr = err as PgError;
    if (pgErr.code === '23505') {
      return NextResponse.json(
        { status: 'error', message: 'Kode afdeling sudah terdaftar pada kebun ini (konflik data unik).' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { status: 'error', message: 'Gagal memperbarui data afdeling.', detail: pgErr.message },
      { status: 500 }
    );
  }
}

// DELETE /api/afdeling?id={id}
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

    const delRes = await query<Afdeling>(
      'DELETE FROM afdeling WHERE id = $1 RETURNING id, kode_afdeling, nama_afdeling;',
      [id]
    );

    if (delRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Afdeling dengan ID ${id} tidak ditemukan.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: 'success',
      message: `Afdeling "${delRes.rows[0].nama_afdeling}" berhasil dihapus.`,
      data: delRes.rows[0],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { status: 'error', message: 'Gagal menghapus data afdeling.', detail: error.message },
      { status: 500 }
    );
  }
}

