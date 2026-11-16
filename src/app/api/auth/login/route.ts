import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { checkCsrf } from '@/lib/auth/csrf';
import { getDummyHash, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { catatAktivitas, KOLOM_PENGGUNA_PUBLIK } from '@/lib/auth/guard';
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from '@/lib/auth/rate-limit';
import type { PenggunaPublik } from '@/types/auth';

const PESAN_KREDENSIAL_SALAH = 'Email atau password salah.';

function errorResponse(status: number, message: string, headers?: HeadersInit) {
  return NextResponse.json({ status: 'error', message }, { status, headers });
}

// POST /api/auth/login
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return errorResponse(403, csrfError);

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return errorResponse(400, 'Email dan password wajib diisi.');
  }
  if (email.length > 254 || password.length > 1024) {
    return errorResponse(400, 'Input terlalu panjang.');
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'lokal';
  const limiterKey = `${ip}|${email}`;
  const retryAfter = isLoginBlocked(limiterKey);
  if (retryAfter > 0) {
    return errorResponse(
      429,
      `Terlalu banyak percobaan login gagal. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.`,
      { 'Retry-After': String(retryAfter) }
    );
  }

  try {
    const res = await query<PenggunaPublik & { kata_sandi_hash: string }>(
      `SELECT ${KOLOM_PENGGUNA_PUBLIK}, kata_sandi_hash FROM pengguna WHERE LOWER(email) = $1 LIMIT 1;`,
      [email]
    );
    const row = res.rows[0];

    // Tetap jalankan bcrypt meski email tidak ada agar waktu respons seragam.
    const passwordValid = await verifyPassword(password, row?.kata_sandi_hash ?? (await getDummyHash()));

    if (!row || !passwordValid) {
      recordLoginFailure(limiterKey);
      if (row) await catatAktivitas(Number(row.id), 'login_gagal', 'Password salah.');
      return errorResponse(401, PESAN_KREDENSIAL_SALAH);
    }

    // Status nonaktif hanya diungkap setelah password terbukti benar.
    if (!row.aktif) {
      await catatAktivitas(Number(row.id), 'login_ditolak', 'Akun nonaktif.');
      return errorResponse(403, 'Akun Anda dinonaktifkan. Hubungi administrator.');
    }

    clearLoginFailures(limiterKey);
    const user: PenggunaPublik = {
      id: Number(row.id),
      nama: row.nama,
      email: row.email,
      peran: row.peran,
      aktif: row.aktif,
      dibuat_pada: row.dibuat_pada,
    };

    const token = await createSessionToken(user.id, user.peran);
    await catatAktivitas(user.id, 'login', null);

    const response = NextResponse.json({ status: 'success', message: 'Login berhasil.', data: user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (err) {
    console.error('Login error:', (err as Error).message);
    return errorResponse(500, 'Terjadi kesalahan server saat login.');
  }
}

