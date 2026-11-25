/**
 * Pembatas percobaan login dan kuota aksi endpoint berbasis memori proses.
 * Cukup untuk satu instance server internal; gunakan penyimpanan bersama
 * (mis. Redis) bila aplikasi dijalankan di beberapa instance.
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface Entry {
  count: number;
  resetAt: number;
}

declare global {
  var __nusagisLoginAttempts: Map<string, Entry> | undefined;
  var __nusagisActionRateLimits: Map<string, Entry> | undefined;
}

const attempts: Map<string, Entry> = (globalThis.__nusagisLoginAttempts ??= new Map());
const actionBuckets: Map<string, Entry> = (globalThis.__nusagisActionRateLimits ??= new Map());

export function isLoginBlocked(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  if (Date.now() > entry.resetAt) {
    attempts.delete(key);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}

/**
 * Pembatas laju umum per pengguna/aksi (misal upload GIS atau pengajuan hak sementara).
 * Mengembalikan sisa waktu tunggu (detik) jika batas terlampaui, atau 0 jika diizinkan.
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): number {
  const now = Date.now();
  const entry = actionBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    actionBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  if (entry.count >= maxRequests) {
    return Math.ceil((entry.resetAt - now) / 1000);
  }
  entry.count += 1;
  return 0;
}


