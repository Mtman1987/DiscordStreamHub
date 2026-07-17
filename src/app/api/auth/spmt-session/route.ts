import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

function withSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(DSH_SPMT_COOKIE, token, cookieOptions);
  return response;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ success: false }, { status: 401 });

  try {
    const resolved = await resolveSpmtSession(token);
    return withSessionCookie(
      NextResponse.json({ success: true, session: resolved.session }),
      resolved.token
    );
  } catch (error) {
    console.warn('[auth/spmt-session] Session validation failed:', error);
    const response = NextResponse.json({ success: false }, { status: 401 });
    response.cookies.set(DSH_SPMT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
    return response;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ success: false, error: 'Missing SPMT token' }, { status: 400 });

  try {
    const resolved = await resolveSpmtSession(token);
    return withSessionCookie(
      NextResponse.json({ success: true, session: resolved.session }),
      resolved.token
    );
  } catch (error) {
    console.warn('[auth/spmt-session] Sign-in failed:', error);
    return NextResponse.json({ success: false, error: 'SPMT sign-in failed' }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(DSH_SPMT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return response;
}
