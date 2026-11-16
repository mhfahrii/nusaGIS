import type { NextRequest } from 'next/server';

/**
 * Proteksi CSRF untuk autentikasi berbasis cookie.
 *
 * Lapisan pertahanan:
 * 1. Cookie sesi SameSite=Lax, sehingga tidak ikut terkirim pada POST/PATCH/DELETE lintas situs.
 * 2. Pemeriksaan header Origin / Sec-Fetch-Site pada request yang mengubah data.
 * 3. Body POST/PATCH wajib JSON; form HTML lintas situs tidak bisa mengirim JSON tanpa preflight CORS.
 *
 * Klien non-browser (curl, skrip) tidak mengirim Origin maupun Sec-Fetch-Site dan
 * bukan vektor CSRF, sehingga tetap diizinkan.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT']);

function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) hosts.add(host.toLowerCase());
  for (const origin of (process.env.APP_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = origin.trim();
    if (!trimmed) continue;
    try {
      hosts.add(new URL(trimmed).host.toLowerCase());
    } catch {
      // abaikan entri yang tidak valid
    }
  }
  return hosts;
}

interface CsrfOptions {
  /** Wajibkan Content-Type JSON untuk POST/PATCH/PUT. Default: true. */
  requireJson?: boolean;
}

/** Mengembalikan pesan error jika request dicurigai CSRF, atau null jika aman. */
export function checkCsrf(req: NextRequest, options: CsrfOptions = {}): string | null {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;

  if ((options.requireJson ?? true) && BODY_METHODS.has(method)) {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return 'Content-Type harus application/json.';
    }
  }

  const origin = req.headers.get('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return 'Header Origin tidak valid.';
    }
    return allowedHosts(req).has(originHost) ? null : 'Permintaan lintas situs ditolak.';
  }

  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return 'Permintaan lintas situs ditolak.';
  }
  return null;
}
