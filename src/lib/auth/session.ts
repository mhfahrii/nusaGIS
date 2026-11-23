/**
 * Token sesi (JWT HS256) yang disimpan di cookie HttpOnly.
 *
 * Modul ini hanya bergantung pada `jose` sehingga bisa dipakai di
 * `proxy.ts` maupun Route Handler. Jangan impor `pg` atau `bcryptjs` di sini.
 */
import { SignJWT, jwtVerify } from 'jose';
import { DAFTAR_PERAN, type Peran, type SessionClaims } from '@/types/auth';

export const SESSION_COOKIE = 'nusagis_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 jam (satu shift kerja)
export const REMEMBER_ME_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 hari

const ISSUER = 'nusagis';
const AUDIENCE = 'nusagis-web';

let cachedKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET belum diatur atau kurang dari 32 karakter. Tambahkan ke .env.local.'
    );
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

export async function createSessionToken(
  userId: number,
  peran: Peran,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  return new SignJWT({ peran })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecretKey());
}

/** Mengembalikan klaim jika token valid, atau null jika tidak valid/kedaluwarsa. */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const peran = payload.peran;
    if (
      typeof payload.sub !== 'string' ||
      typeof peran !== 'string' ||
      !(DAFTAR_PERAN as readonly string[]).includes(peran)
    ) {
      return null;
    }
    return { sub: payload.sub, peran: peran as Peran };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge: number = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

