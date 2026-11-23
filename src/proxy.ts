import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

/**
 * Pemeriksaan sesi optimistik sebelum halaman/API dirender.
 * Hanya memverifikasi tanda tangan token (tanpa database). Verifikasi penuh
 * (akun aktif, peran terkini) tetap dilakukan di setiap Route Handler
 * melalui `requireUser`.
 */

const PUBLIC_PAGES = new Set(['/login']);
const PUBLIC_APIS = new Set(['/api/auth/login', '/api/auth/logout']);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith('/api/')) {
    if (PUBLIC_APIS.has(pathname) || session) return NextResponse.next();
    return NextResponse.json(
      { status: 'error', message: 'Sesi tidak valid atau telah berakhir. Silakan login.' },
      { status: 401 }
    );
  }

  if (PUBLIC_PAGES.has(pathname)) {
    return session ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude upload endpoints so large GIS streams are not cloned/buffered into memory; auth is checked in handlers via requireUser.
    '/((?!_next/static|_next/image|favicon.ico|api/gis/inspect|api/gis/upload|.*\\.[\\w]+$).*)',
  ],
};

