import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { checkCsrf } from '@/lib/auth/csrf';
import { SESSION_COOKIE, sessionCookieOptions, verifySessionToken } from '@/lib/auth/session';
import type { Peran, PenggunaPublik } from '@/types/auth';

/**
 * Data Access Layer untuk autentikasi.
 *
 * Setiap Route Handler wajib memanggil `requireUser` karena proxy hanya
 * melakukan pemeriksaan optimistik. Fungsi ini memverifikasi token,
 * lalu membaca ulang data pengguna dari database sehingga akun yang
 * dinonaktifkan atau diubah perannya langsung kehilangan akses.
 */

export const KOLOM_PENGGUNA_PUBLIK = 'id, nama, email, peran, aktif, dibuat_pada';

type AuthResult = { user: PenggunaPublik; response?: never } | { user?: never; response: NextResponse };

interface RequireUserOptions {
  /** Peran yang diizinkan. Kosong berarti semua pengguna yang login. */
  roles?: Peran[];
  /** Teruskan ke pemeriksaan CSRF. */
  requireJson?: boolean;
}

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ status: 'error', message }, { status });
}

function unauthorized(message: string, clearCookie = false): NextResponse {
  const res = errorResponse(401, message);
  if (clearCookie) res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return res;
}

export async function findActiveUserById(id: number): Promise<PenggunaPublik | null> {
  const res = await query<PenggunaPublik>(
    `SELECT ${KOLOM_PENGGUNA_PUBLIK} FROM pengguna WHERE id = $1;`,
    [id]
  );
  const user = res.rows[0];
  if (!user || !user.aktif) return null;
  return { ...user, id: Number(user.id) };
}

export async function requireUser(
  req: NextRequest,
  options: RequireUserOptions = {}
): Promise<AuthResult> {
  const csrfError = checkCsrf(req, { requireJson: options.requireJson });
  if (csrfError) return { response: errorResponse(403, csrfError) };

  const claims = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!claims) {
    return { response: unauthorized('Sesi tidak valid atau telah berakhir. Silakan login.') };
  }

  const userId = Number(claims.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { response: unauthorized('Sesi tidak valid. Silakan login.', true) };
  }

  let user: PenggunaPublik | null;
  try {
    user = await findActiveUserById(userId);
  } catch {
    return { response: errorResponse(503, 'Gagal memverifikasi sesi: database tidak tersedia.') };
  }

  if (!user) {
    return { response: unauthorized('Akun tidak ditemukan atau telah dinonaktifkan.', true) };
  }

  if (options.roles && options.roles.length > 0 && !options.roles.includes(user.peran)) {
    return { response: errorResponse(403, 'Anda tidak memiliki hak akses untuk tindakan ini.') };
  }

  return { user };
}

/** Pencatatan ke riwayat_aktivitas. Kegagalan pencatatan tidak menggagalkan request utama. */
export async function catatAktivitas(
  penggunaId: number | null,
  aktivitas: string,
  keterangan: string | null = null
): Promise<void> {
  try {
    await query(
      'INSERT INTO riwayat_aktivitas (pengguna_id, aktivitas, keterangan) VALUES ($1, $2, $3);',
      [penggunaId, aktivitas, keterangan]
    );
  } catch (err) {
    console.error('Gagal mencatat aktivitas:', (err as Error).message);
  }
}

