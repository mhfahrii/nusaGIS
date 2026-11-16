/**
 * Pembatas percobaan login sederhana berbasis memori proses.
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
}

const attempts: Map<string, Entry> = (globalThis.__nusagisLoginAttempts ??= new Map());

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

