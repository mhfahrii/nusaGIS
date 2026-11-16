import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/guard';

// GET /api/auth/me
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  return NextResponse.json({ status: 'success', data: auth.user });
}

