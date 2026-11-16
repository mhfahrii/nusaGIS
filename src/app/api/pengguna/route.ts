import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, KOLOM_PENGGUNA_PUBLIK, requireUser } from '@/lib/auth/guard';
import { hashPassword, validatePassword } from '@/lib/auth/password';
import { DAFTAR_PERAN, type Peran, type PenggunaPublik } from '@/types/auth';

/**
 * Manajemen pengguna internal (khusus admin).
 * Tidak ada endpoint DELETE: akun dinonaktifkan (aktif = false) agar
 * jejak di riwayat_aktivitas tetap terhubung ke pemiliknya.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorResponse(status: number, message: string) {
  return NextResponse.json({ status: 'error', message }, { status });
}

function isPeran(value: unknown): value is Peran {
  return typeof value === 'string' && (DAFTAR_PERAN as readonly string[]).includes(value);
}

function normalize(row: PenggunaPublik): PenggunaPublik {
  return { ...row, id: Number(row.id) };
}

function handleError(err: unknown, fallback: string) {
  const code = (err as { code?: string }).code;
  if (code === '23505') return errorResponse(409, 'Email sudah terdaftar.');
  if (code === '23514') return errorResponse(400, 'Nilai peran tidak valid.');
  console.error(fallback, (err as Error).message);
  return errorResponse(500, fallback);
}

// GET /api/pengguna (opsional ?id={id})
export async function GET(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
  if (auth.response) return auth.response;

  try {
    const idParam = req.nextUrl.searchParams.get('id');
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return errorResponse(400, 'Parameter ID harus berupa angka positif.');
      }
      const res = await query<PenggunaPublik>(
        `SELECT ${KOLOM_PENGGUNA_PUBLIK} FROM pengguna WHERE id = $1;`,
        [id]
      );
      if (res.rowCount === 0) return errorResponse(404, `Pengguna dengan ID ${id} tidak ditemukan.`);
      return NextResponse.json({ status: 'success', data: normalize(res.rows[0]) });
    }

    const res = await query<PenggunaPublik>(
      `SELECT ${KOLOM_PENGGUNA_PUBLIK} FROM pengguna ORDER BY nama ASC;`
    );
    return NextResponse.json({ status: 'success', total: res.rowCount, data: res.rows.map(normalize) });
  } catch (err) {
    return handleError(err, 'Gagal mengambil data pengguna.');
  }
}

// POST /api/pengguna
export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return errorResponse(400, 'Format JSON body tidak valid.');

  const nama = typeof body.nama === 'string' ? body.nama.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const peran: unknown = body.peran ?? 'pengguna';
  const aktif: unknown = body.aktif ?? true;

  if (!nama) return errorResponse(400, 'Field "nama" wajib diisi.');
  if (!email || !EMAIL_REGEX.test(email) || email.length > 254) {
    return errorResponse(400, 'Field "email" tidak valid.');
  }
  if (!isPeran(peran)) return errorResponse(400, 'Field "peran" harus "admin" atau "pengguna".');
  if (typeof aktif !== 'boolean') return errorResponse(400, 'Field "aktif" harus boolean.');
  const passwordError = validatePassword(body.password);
  if (passwordError) return errorResponse(400, passwordError);

  try {
    const dup = await query('SELECT 1 FROM pengguna WHERE LOWER(email) = $1;', [email]);
    if (dup.rowCount) return errorResponse(409, 'Email sudah terdaftar.');

    const hash = await hashPassword(body.password);
    const res = await query<PenggunaPublik>(
      `INSERT INTO pengguna (nama, email, kata_sandi_hash, peran, aktif)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${KOLOM_PENGGUNA_PUBLIK};`,
      [nama, email, hash, peran, aktif]
    );
    const created = normalize(res.rows[0]);
    await catatAktivitas(auth.user.id, 'tambah_pengguna', `Menambahkan pengguna ${created.email} (${created.peran}).`);
    return NextResponse.json(
      { status: 'success', message: 'Pengguna berhasil ditambahkan.', data: created },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err, 'Gagal menambahkan pengguna.');
  }
}

// PATCH /api/pengguna
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req, { roles: ['admin'] });
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return errorResponse(400, 'Format JSON body tidak valid.');

  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return errorResponse(400, 'Field "id" harus berupa angka positif.');

  const updates: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  if (body.nama !== undefined) {
    const nama = typeof body.nama === 'string' ? body.nama.trim() : '';
    if (!nama) return errorResponse(400, 'Field "nama" tidak boleh kosong.');
    add('nama', nama);
  }
  let newEmail: string | null = null;
  if (body.email !== undefined) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_REGEX.test(email) || email.length > 254) {
      return errorResponse(400, 'Field "email" tidak valid.');
    }
    newEmail = email;
    add('email', email);
  }
  if (body.peran !== undefined) {
    if (!isPeran(body.peran)) return errorResponse(400, 'Field "peran" harus "admin" atau "pengguna".');
    add('peran', body.peran);
  }
  if (body.aktif !== undefined) {
    if (typeof body.aktif !== 'boolean') return errorResponse(400, 'Field "aktif" harus boolean.');
    add('aktif', body.aktif);
  }
  if (body.password !== undefined) {
    const passwordError = validatePassword(body.password);
    if (passwordError) return errorResponse(400, passwordError);
    add('kata_sandi_hash', await hashPassword(body.password));
  }

  if (updates.length === 0) return errorResponse(400, 'Tidak ada field yang diperbarui.');

  // Cegah admin mengunci dirinya sendiri.
  if (id === auth.user.id && (body.aktif === false || body.peran === 'pengguna')) {
    return errorResponse(400, 'Anda tidak dapat menonaktifkan atau menurunkan peran akun sendiri.');
  }

  try {
    const existing = await query('SELECT id FROM pengguna WHERE id = $1;', [id]);
    if (existing.rowCount === 0) return errorResponse(404, `Pengguna dengan ID ${id} tidak ditemukan.`);

    if (newEmail) {
      const dup = await query('SELECT 1 FROM pengguna WHERE LOWER(email) = $1 AND id <> $2;', [newEmail, id]);
      if (dup.rowCount) return errorResponse(409, 'Email sudah terdaftar.');
    }

    values.push(id);
    const res = await query<PenggunaPublik>(
      `UPDATE pengguna SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING ${KOLOM_PENGGUNA_PUBLIK};`,
      values
    );
    const updated = normalize(res.rows[0]);
    const fields = updates.map((u) => u.split(' ')[0].replace('kata_sandi_hash', 'password')).join(', ');
    await catatAktivitas(auth.user.id, 'ubah_pengguna', `Mengubah ${fields} pada pengguna ${updated.email}.`);
    return NextResponse.json({ status: 'success', message: 'Pengguna berhasil diperbarui.', data: updated });
  } catch (err) {
    return handleError(err, 'Gagal memperbarui pengguna.');
  }
}
