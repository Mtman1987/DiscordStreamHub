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
  let token = typeof body?.token === 'string' ? body.token.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!token && code) {
    const clientSecret = process.env.DSH_CLIENT_SECRET || '';
    if (!clientSecret) return NextResponse.json({ success: false, error: 'DSH OAuth is not configured' }, { status: 503 });
    const exchange = await fetch('https://spmt.live/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, client_id: 'discord-stream-hub', client_secret: clientSecret, redirect_uri: 'https://discord-stream-hub-new.fly.dev/auth/callback' }),
      cache: 'no-store',
    });
    const exchangeData = await exchange.json().catch(() => null);
    if (!exchange.ok || !exchangeData?.access_token) return NextResponse.json({ success: false, error: 'SPMT code exchange failed' }, { status: 401 });
    token = exchangeData.access_token;
  }
  if (!token) return NextResponse.json({ success: false, error: 'Missing SPMT authorization code' }, { status: 400 });

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
