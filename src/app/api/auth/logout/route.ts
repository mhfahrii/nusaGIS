import { NextResponse, type NextRequest } from 'next/server';
import { checkCsrf } from '@/lib/auth/csrf';
import { catatAktivitas } from '@/lib/auth/guard';
import { SESSION_COOKIE, sessionCookieOptions, verifySessionToken } from '@/lib/auth/session';

// POST /api/auth/logout
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req, { requireJson: false });
  if (csrfError) {
    return NextResponse.json({ status: 'error', message: csrfError }, { status: 403 });
  }

  const claims = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (claims) await catatAktivitas(Number(claims.sub), 'logout', null);

  const response = NextResponse.json({ status: 'success', message: 'Logout berhasil.' });
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return response;
}

