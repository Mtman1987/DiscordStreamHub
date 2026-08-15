import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, SPMT_BASE_URL, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const DSH_SPMT_REFRESH_COOKIE = 'dsh_spmt_refresh';
const DSH_SPMT_STATE_COOKIE = 'dsh_spmt_oauth_state';
const DSH_SPMT_NEXT_COOKIE = 'dsh_spmt_oauth_next';
const REDIRECT_URI = 'https://discord-stream-hub-new.fly.dev/auth/callback';
const SPMT_REQUEST_TIMEOUT_MS = 5000;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

function requestSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(SPMT_REQUEST_TIMEOUT_MS);
}

function safeNextPath(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

function statesMatch(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function clearOauthCookies(response: NextResponse) {
  response.cookies.set(DSH_SPMT_STATE_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(DSH_SPMT_NEXT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return response;
}

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
    signal: requestSignal(),
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
  const receivedState = typeof body?.state === 'string' ? body.state.trim() : '';
  const expectedState = request.cookies.get(DSH_SPMT_STATE_COOKIE)?.value || '';
  const nextPath = safeNextPath(request.cookies.get(DSH_SPMT_NEXT_COOKIE)?.value);

  if (!token && code) {
    if (!statesMatch(receivedState, expectedState)) {
      return clearOauthCookies(NextResponse.json({ success: false, error: 'Invalid or expired SPMT OAuth state' }, { status: 400 }));
    }

    const clientSecret = process.env.DSH_CLIENT_SECRET || '';
    if (!clientSecret) {
      return clearOauthCookies(NextResponse.json({ success: false, error: 'DSH OAuth is not configured' }, { status: 503 }));
    }

    const exchange = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, client_id: 'discord-stream-hub', client_secret: clientSecret, redirect_uri: REDIRECT_URI }),
      cache: 'no-store',
      signal: requestSignal(),
    }).catch(() => null);
    const exchangeData = await exchange?.json().catch(() => null);
    if (!exchange?.ok || !exchangeData?.access_token || !exchangeData?.user?.id) {
      return clearOauthCookies(NextResponse.json({ success: false, error: 'SPMT code exchange failed' }, { status: 401 }));
    }
    token = String(exchangeData.access_token);
    exchangedIdentity = exchangeData.user;
    exchangedRefreshToken = String(exchangeData.refresh_token || '');
    exchangedExpiresIn = Number(exchangeData.expires_in || 604800);
    exchangedRefreshExpiresIn = Number(exchangeData.refresh_expires_in || 2592000);
  }
  if (!token) return NextResponse.json({ success: false, error: 'Missing SPMT authorization code' }, { status: 400 });

  try {
    const resolved = await resolveSpmtSession(token, exchangedIdentity);
    const response = withSessionCookies(
      NextResponse.json({ success: true, session: resolved.session, next: nextPath }),
      resolved.token,
      exchangedRefreshToken,
      exchangedExpiresIn,
      exchangedRefreshExpiresIn
    );
    return clearOauthCookies(response);
  } catch (error) {
    console.warn('[auth/spmt-session] Sign-in failed:', error);
    return clearOauthCookies(NextResponse.json({ success: false, error: 'SPMT sign-in failed' }, { status: 401 }));
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(DSH_SPMT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(DSH_SPMT_REFRESH_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return clearOauthCookies(response);
}
