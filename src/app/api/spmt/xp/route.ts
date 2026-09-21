import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, SPMT_BASE_URL, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const resolved = await resolveSpmtSession(token);
    const response = await fetch(`${SPMT_BASE_URL}/api/xp`, {
      headers: { Authorization: `Bearer ${resolved.token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error || 'Canonical XP unavailable' },
        { status: response.status }
      );
    }

    const xp = Number(payload?.xp);
    const level = Number(payload?.level);
    if (!Number.isFinite(xp) || !Number.isFinite(level)) {
      return NextResponse.json({ error: 'Invalid canonical XP response' }, { status: 502 });
    }

    const result = NextResponse.json({
      xp: Math.max(0, Math.trunc(xp)),
      level: Math.max(1, Math.trunc(level)),
    });
    if (resolved.token !== token) {
      result.cookies.set(DSH_SPMT_COOKIE, resolved.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return result;
  } catch {
    return NextResponse.json({ error: 'Canonical XP unavailable' }, { status: 502 });
  }
}
