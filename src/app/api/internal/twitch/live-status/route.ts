import { NextRequest, NextResponse } from 'next/server';
import { getStreamByLoginStrict } from '@/lib/twitch-api-service';

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const expected = String(process.env.SPMT_API_KEY || process.env.SPMT_PLATFORM_API_KEY || '').trim();
  const provided = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && provided && provided === expected);
}

function normalizeLogin(value: string | null): string {
  const login = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : '';
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const login = normalizeLogin(request.nextUrl.searchParams.get('login'));
  if (!login) return NextResponse.json({ error: 'Valid Twitch login is required' }, { status: 400 });

  try {
    const stream = await getStreamByLoginStrict(login);
    return NextResponse.json({
      ok: true,
      login,
      isLive: Boolean(stream),
      checkedAt: new Date().toISOString(),
      startedAt: stream?.started_at || null,
      streamId: stream?.id || null,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[stream-continuity] Twitch live-status lookup failed');
    return NextResponse.json({
      ok: false,
      login,
      error: 'Twitch live-status lookup failed',
      checkedAt: new Date().toISOString(),
    }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
