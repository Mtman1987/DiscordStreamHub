import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { SPMT_BASE_URL } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'dsh_spmt_oauth_state';
const NEXT_COOKIE = 'dsh_spmt_oauth_next';
const REDIRECT_URI = 'https://discord-stream-hub-new.fly.dev/auth/callback';

function safeNextPath(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

const transientCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 10 * 60,
};

export async function GET(request: NextRequest) {
  const state = randomBytes(32).toString('base64url');
  const nextPath = safeNextPath(request.nextUrl.searchParams.get('next'));
  const authorize = new URL('/api/oauth/authorize', SPMT_BASE_URL);
  authorize.searchParams.set('client_id', 'discord-stream-hub');
  authorize.searchParams.set('redirect_uri', REDIRECT_URI);
  authorize.searchParams.set('state', state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(STATE_COOKIE, state, transientCookie);
  response.cookies.set(NEXT_COOKIE, nextPath, transientCookie);
  return response;
}
