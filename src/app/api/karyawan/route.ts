import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { catatAktivitas, requireUser, safeErrorDetail } from '@/lib/auth/guard';
import { hashPassword, PASSWORD_MAX_BYTES } from '@/lib/auth/password';
import {
  DAFTAR_PERAN,
  normalizeHakAkses,
  type HakAksesFitur,
  type Peran,
  type PenggunaPublik,
} from '@/types/auth';

const MAX_FOTO_PROFIL_LENGTH = 2 * 1024 * 1024; // Maks 2MB data URL

function validateFlexiblePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password wajib diisi.';
  }
  if (password.length < 4) {
    return 'Password minimal 4 karakter.';
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password maksimal ${PASSWORD_MAX_BYTES} byte.`;
  }
  return null;
}

let columnEnsured = false;

async function ensureKaryawanColumns() {
  if (columnEnsured) return;
  try {
    await query('ALTER TABLE public.pengguna ADD COLUMN IF NOT EXISTS hak_akses JSONB;');
    await query('ALTER TABLE public.pengguna ADD COLUMN IF NOT EXISTS foto_profil TEXT;');
    columnEnsured = true;
  } catch {
    // Abaikan jika sudah ada
  }
}

export interface KaryawanRecord extends PenggunaPublik {
  kode_karyawan: string;
  hak_akses: HakAksesFitur;
  foto_profil: string | null;
}

function formatKaryawanRow(row: PenggunaPublik): KaryawanRecord {
  const numericId = Number(row.id);
  return {
    id: numericId,
    kode_karyawan: `EMP-${String(numericId).padStart(4, '0')}`,
    nama: row.nama,
    email: row.email,
    peran: row.peran,
    aktif: Boolean(row.aktif),
    hak_akses: normalizeHakAkses(row.hak_akses, row.peran),
    foto_profil: row.foto_profil ?? null,
    dibuat_pada: row.dibuat_pada,
  };
}

function canManageEmployees(user: PenggunaPublik): boolean {
  return user.peran === 'admin' || Boolean(user.hak_akses?.kelola_karyawan);
}

// GET /api/karyawan - Mengambil daftar seluruh akun karyawan dari database
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    await ensureKaryawanColumns();

    const canManage = canManageEmployees(auth.user);
    const res = await query<PenggunaPublik>(
      canManage
        ? `SELECT id, nama, email, peran, aktif, hak_akses, foto_profil, dibuat_pada
           FROM public.pengguna
           ORDER BY id ASC;`
        : `SELECT id, nama, email, peran, aktif, hak_akses, foto_profil, dibuat_pada
           FROM public.pengguna
           WHERE id = $1
           ORDER BY id ASC;`,
      canManage ? [] : [auth.user.id]
    );

    const data: KaryawanRecord[] = res.rows.map(formatKaryawanRow);

    return NextResponse.json({
      status: 'success',
      total: data.length,
      data,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memuat daftar karyawan dari database.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// POST /api/karyawan - Membuat akun karyawan baru ke dalam database public.pengguna
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  if (!canManageEmployees(auth.user)) {
    return NextResponse.json(
      { status: 'error', message: 'Anda tidak memiliki hak akses untuk membuat akun karyawan.' },
      { status: 403 }
    );
  }

  try {
    await ensureKaryawanColumns();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { status: 'error', message: 'Format data JSON tidak valid.' },
        { status: 400 }
      );
    }

    const nama = typeof body.nama === 'string' ? body.nama.trim() : '';
    const rawIdentifier = typeof body.email === 'string' ? body.email.trim() : '';
    const email = (rawIdentifier || nama).trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const rawPeran = typeof body.peran === 'string' ? body.peran.trim().toLowerCase() : 'pengguna';
    const peran: Peran = (DAFTAR_PERAN as readonly string[]).includes(rawPeran)
      ? (rawPeran as Peran)
      : 'pengguna';
    const aktif = typeof body.aktif === 'boolean' ? body.aktif : true;
    const hakAkses = normalizeHakAkses(body.hak_akses, peran);
    const fotoProfil =
      typeof body.foto_profil === 'string' && body.foto_profil.trim().length > 0
        ? body.foto_profil.trim()
        : null;

    if (!nama || nama.length < 2) {
      return NextResponse.json(
        { status: 'error', message: 'Nama / Username karyawan wajib diisi (minimal 2 karakter).' },
        { status: 400 }
      );
    }
    if (nama.length > 100 || email.length > 150) {
      return NextResponse.json(
        { status: 'error', message: 'Nama atau ID Akun terlalu panjang.' },
        { status: 400 }
      );
    }
    if (fotoProfil && fotoProfil.length > MAX_FOTO_PROFIL_LENGTH) {
      return NextResponse.json(
        { status: 'error', message: 'Ukuran foto profil terlalu besar.' },
        { status: 400 }
      );
    }

    const pwdError = validateFlexiblePassword(password);
    if (pwdError) {
      return NextResponse.json({ status: 'error', message: pwdError }, { status: 400 });
    }

    // Periksa duplikasi ID Akun atau Username di database
    const dupCheck = await query<{ id: number; nama: string; email: string }>(
      `SELECT id, nama, email FROM public.pengguna
       WHERE LOWER(email) = LOWER($1) OR LOWER(nama) = LOWER($2)
       LIMIT 1;`,
      [email, nama]
    );

    if (dupCheck.rowCount && dupCheck.rowCount > 0) {
      const existing = dupCheck.rows[0];
      if (existing.email.toLowerCase() === email.toLowerCase()) {
        return NextResponse.json(
          { status: 'error', message: `ID / Username "${email}" sudah terdaftar di database.` },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { status: 'error', message: `Nama / Username "${nama}" sudah digunakan oleh akun lain.` },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const insertRes = await query<PenggunaPublik>(
      `INSERT INTO public.pengguna (nama, email, kata_sandi_hash, peran, aktif, hak_akses, foto_profil, dibuat_pada)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
       RETURNING id, nama, email, peran, aktif, hak_akses, foto_profil, dibuat_pada;`,
      [nama, email, passwordHash, peran, aktif, JSON.stringify(hakAkses), fotoProfil]
    );

    const created = formatKaryawanRow(insertRes.rows[0]);

    await catatAktivitas(
      auth.user.id,
      'buat_akun_karyawan',
      `Membuat akun karyawan baru "${created.nama}" (${created.email}) dengan role ${created.peran.toUpperCase()}.`
    );

    return NextResponse.json(
      {
        status: 'success',
        message: `Akun karyawan "${created.nama}" berhasil dibuat dan disimpan ke database.`,
        data: created,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal menyimpan akun karyawan baru ke database.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// PATCH /api/karyawan - Memperbarui data, foto profil, role, hak akses, status aktif, atau password karyawan
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  try {
    await ensureKaryawanColumns();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { status: 'error', message: 'Format data JSON tidak valid.' },
        { status: 400 }
      );
    }

    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'ID karyawan tidak valid.' },
        { status: 400 }
      );
    }

    const isSelf = id === auth.user.id;
    const isAdminOrManager = canManageEmployees(auth.user);

    if (!isAdminOrManager && !isSelf) {
      return NextResponse.json(
        { status: 'error', message: 'Anda tidak memiliki hak akses untuk mengubah akun karyawan lain.' },
        { status: 403 }
      );
    }

    const existingRes = await query<PenggunaPublik>(
      'SELECT id, nama, email, peran, aktif, hak_akses, foto_profil, dibuat_pada FROM public.pengguna WHERE id = $1;',
      [id]
    );
    if (existingRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: `Akun karyawan dengan ID #${id} tidak ditemukan.` },
        { status: 404 }
      );
    }
    const current = existingRes.rows[0];

    const nextFotoProfil =
      body.foto_profil !== undefined
        ? typeof body.foto_profil === 'string' && body.foto_profil.trim().length > 0
          ? body.foto_profil.trim()
          : null
        : (current.foto_profil ?? null);

    if (nextFotoProfil && nextFotoProfil.length > MAX_FOTO_PROFIL_LENGTH) {
      return NextResponse.json(
        { status: 'error', message: 'Ukuran foto profil terlalu besar.' },
        { status: 400 }
      );
    }

    // Jika bukan admin dan hanya mengupdate profil sendiri, batasi hanya foto_profil
    if (!isAdminOrManager && isSelf) {
      const selfRes = await query<PenggunaPublik>(
        `UPDATE public.pengguna
         SET foto_profil = $1
         WHERE id = $2
         RETURNING id, nama, email, peran, aktif, hak_akses, foto_profil, dibuat_pada;`,
        [nextFotoProfil, id]
      );
      return NextResponse.json({
        status: 'success',
        message: 'Foto profil berhasil diperbarui.',
        data: formatKaryawanRow(selfRes.rows[0]),
      });
    }

    const nextNama = typeof body.nama === 'string' ? body.nama.trim() : current.nama;
    const nextEmail =
      typeof body.email === 'string' && body.email.trim()
        ? body.email.trim()
        : (current.email || nextNama);
    const rawPeran =
      typeof body.peran === 'string' ? body.peran.trim().toLowerCase() : current.peran;
    const nextPeran: Peran = (DAFTAR_PERAN as readonly string[]).includes(rawPeran)
      ? (rawPeran as Peran)
      : current.peran;
    const nextAktif = typeof body.aktif === 'boolean' ? body.aktif : Boolean(current.aktif);
    const nextHakAkses =
      body.hak_akses !== undefined
        ? normalizeHakAkses(body.hak_akses, nextPeran)
        : normalizeHakAkses(current.hak_akses, nextPeran);

    if (!nextNama || nextNama.length < 2) {
      return NextResponse.json(
        { status: 'error', message: 'Nama / Username minimal 2 karakter.' },
        { status: 400 }
      );
    }

    // Cegah admin menonaktifkan atau mencabut role admin dari dirinya sendiri
    if (id === auth.user.id) {
      if (!nextAktif) {
        return NextResponse.json(
          { status: 'error', message: 'Anda tidak dapat menonaktifkan akun Anda sendiri yang sedang digunakan.' },
          { status: 400 }
        );
      }
      if (auth.user.peran === 'admin' && nextPeran !== 'admin') {
        return NextResponse.json(
          { status: 'error', message: 'Anda tidak dapat menurunkan role Admin pada akun Anda sendiri.' },
          { status: 400 }
        );
      }
    }

    // Cek duplikasi nama/ID pada user lain
    const dupCheck = await query<{ id: number; nama: string; email: string }>(
      `SELECT id, nama, email FROM public.pengguna
       WHERE id != $1 AND (LOWER(email) = LOWER($2) OR LOWER(nama) = LOWER($3))
       LIMIT 1;`,
      [id, nextEmail, nextNama]
    );
    if (dupCheck.rowCount && dupCheck.rowCount > 0) {
      const dup = dupCheck.rows[0];
      if (dup.email.toLowerCase() === nextEmail.toLowerCase()) {
        return NextResponse.json(
          { status: 'error', message: `ID / Username "${nextEmail}" sudah dipakai oleh akun lain.` },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { status: 'error', message: `Nama / Username "${nextNama}" sudah dipakai oleh akun lain.` },
        { status: 409 }
      );
    }

    let passwordUpdated = false;
    if (typeof body.password === 'string' && body.password.trim().length > 0) {
      const pwdError = validateFlexiblePassword(body.password);
      if (pwdError) {
        return NextResponse.json({ status: 'error', message: pwdError }, { status: 400 });
      }
      const newHash = await hashPassword(body.password);
      await query('UPDATE public.pengguna SET kata_sandi_hash = $1 WHERE id = $2;', [newHash, id]);
      passwordUpdated = true;
    }

    const updateRes = await query<PenggunaPublik>(
      `UPDATE public.pengguna
       SET nama = $1,
           email = $2,
           peran = $3,
           aktif = $4,
           hak_akses = $5::jsonb,
           foto_profil = $6
       WHERE id = $7
       RETURNING id, nama, email, peran, aktif, hak_akses, foto_profil, dibuat_pada;`,
      [nextNama, nextEmail, nextPeran, nextAktif, JSON.stringify(nextHakAkses), nextFotoProfil, id]
    );

    const updated = formatKaryawanRow(updateRes.rows[0]);

    await catatAktivitas(
      auth.user.id,
      'ubah_akun_karyawan',
      `Memperbarui akun "${updated.nama}" (${updated.email}) - Role: ${updated.peran.toUpperCase()}, Status: ${
        updated.aktif ? 'Aktif' : 'Nonaktif'
      }${passwordUpdated ? ' (Password direset)' : ''}.`
    );

    return NextResponse.json({
      status: 'success',
      message: `Data akun "${updated.nama}" berhasil diperbarui.`,
      data: updated,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal memperbarui akun karyawan.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}

// DELETE /api/karyawan?id={id} - Menghapus akun karyawan dari database
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req, { requireJson: false });
  if (auth.response) return auth.response;

  if (!canManageEmployees(auth.user)) {
    return NextResponse.json(
      { status: 'error', message: 'Anda tidak memiliki hak akses untuk menghapus akun karyawan.' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter ID karyawan tidak valid.' },
        { status: 400 }
      );
    }

    if (id === auth.user.id) {
      return NextResponse.json(
        { status: 'error', message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif login.' },
        { status: 400 }
      );
    }

    const existingRes = await query<PenggunaPublik>(
      'SELECT id, nama, email, peran FROM public.pengguna WHERE id = $1;',
      [id]
    );
    if (existingRes.rowCount === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Akun karyawan tidak ditemukan.' },
        { status: 404 }
      );
    }
    const target = existingRes.rows[0];

    await query('UPDATE public.riwayat_aktivitas SET pengguna_id = NULL WHERE pengguna_id = $1;', [id]);
    await query('UPDATE public.fitur_peta SET dibuat_oleh_user_id = NULL WHERE dibuat_oleh_user_id = $1;', [id]);
    await query('UPDATE public.fitur_peta SET diubah_oleh_user_id = NULL WHERE diubah_oleh_user_id = $1;', [id]);
    await query('UPDATE public.fitur_peta SET dihapus_oleh_user_id = NULL WHERE dihapus_oleh_user_id = $1;', [id]);
    await query('UPDATE public.layer_peta SET dihapus_oleh_user_id = NULL WHERE dihapus_oleh_user_id = $1;', [id]);
    await query('UPDATE public.data_unggahan SET pengguna_id = $1 WHERE pengguna_id = $2;', [
      auth.user.id,
      id,
    ]);

    await query('DELETE FROM public.pengguna WHERE id = $1;', [id]);

    await catatAktivitas(
      auth.user.id,
      'hapus_akun_karyawan',
      `Menghapus akun karyawan "${target.nama}" (${target.email}) dari sistem.`
    );

    return NextResponse.json({
      status: 'success',
      message: `Akun karyawan "${target.nama}" berhasil dihapus dari database.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Gagal menghapus akun karyawan.',
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
