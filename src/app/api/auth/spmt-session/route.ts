import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, SPMT_BASE_URL, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const DSH_SPMT_REFRESH_COOKIE = 'dsh_spmt_refresh';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

function withSessionCookies(response: NextResponse, token: string, refreshToken?: string, expiresIn = 604800, refreshExpiresIn = 2592000) {
  response.cookies.set(DSH_SPMT_COOKIE, token, { ...cookieOptions, maxAge: expiresIn });
  if (refreshToken) response.cookies.set(DSH_SPMT_REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: refreshExpiresIn });
  return response;
}

async function refreshSession(request: NextRequest) {
  const refreshToken = request.cookies.get(DSH_SPMT_REFRESH_COOKIE)?.value || '';
  const clientSecret = String(process.env.DSH_CLIENT_SECRET || '').trim();
  if (!refreshToken || !clientSecret) return null;
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'discord-stream-hub', client_secret: clientSecret }),
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.access_token && payload?.refresh_token ? payload : null;
}

export async function GET(request: NextRequest) {
  let token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  try {
    let refreshed: any = null;
    let resolved = token ? await resolveSpmtSession(token).catch(() => null) : null;
    if (!resolved) {
      refreshed = await refreshSession(request);
      if (refreshed) {
        token = String(refreshed.access_token);
        // Refresh exchanges already contain the canonical user too, so avoid a
        // second SPMT request when we have that identity available.
        resolved = await resolveSpmtSession(token, refreshed.user);
      }
    }
    if (!resolved) return NextResponse.json({ success: false }, { status: 401 });
    return withSessionCookies(
      NextResponse.json({ success: true, session: resolved.session }),
      resolved.token,
      refreshed?.refresh_token,
      Number(refreshed?.expires_in || 604800),
      Number(refreshed?.refresh_expires_in || 2592000)
    );
  } catch (error) {
    console.warn('[auth/spmt-session] Session validation failed:', error);
    return NextResponse.json({ success: false }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  let token = typeof body?.token === 'string' ? body.token.trim() : '';
  let exchangedIdentity: any = null;
  let exchangedRefreshToken = '';
  let exchangedExpiresIn = 604800;
  let exchangedRefreshExpiresIn = 2592000;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!token && code) {
    const clientSecret = process.env.DSH_CLIENT_SECRET || '';
    if (!clientSecret) return NextResponse.json({ success: false, error: 'DSH OAuth is not configured' }, { status: 503 });
    const exchange = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, client_id: 'discord-stream-hub', client_secret: clientSecret, redirect_uri: 'https://discord-stream-hub-new.fly.dev/auth/callback' }),
      cache: 'no-store',
    });
    const exchangeData = await exchange.json().catch(() => null);
    if (!exchange.ok || !exchangeData?.access_token || !exchangeData?.user?.id) {
      return NextResponse.json({ success: false, error: 'SPMT code exchange failed' }, { status: 401 });
    }
    token = String(exchangeData.access_token);
    exchangedIdentity = exchangeData.user;
    exchangedRefreshToken = String(exchangeData.refresh_token || '');
    exchangedExpiresIn = Number(exchangeData.expires_in || 604800);
    exchangedRefreshExpiresIn = Number(exchangeData.refresh_expires_in || 2592000);
  }
  if (!token) return NextResponse.json({ success: false, error: 'Missing SPMT authorization code' }, { status: 400 });

  try {
    // A code exchange is authoritative and already includes the canonical SPMT
    // user, so login no longer pays for an immediate second userinfo round trip.
    // Direct legacy token posts still validate through userinfo as before.
    const resolved = await resolveSpmtSession(token, exchangedIdentity);
    return withSessionCookies(
      NextResponse.json({ success: true, session: resolved.session }),
      resolved.token,
      exchangedRefreshToken,
      exchangedExpiresIn,
      exchangedRefreshExpiresIn
    );
  } catch (error) {
    console.warn('[auth/spmt-session] Sign-in failed:', error);
    return NextResponse.json({ success: false, error: 'SPMT sign-in failed' }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(DSH_SPMT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(DSH_SPMT_REFRESH_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return response;
}
