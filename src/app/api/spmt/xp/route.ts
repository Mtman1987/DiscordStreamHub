import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, SPMT_BASE_URL } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const response = await fetch(`${SPMT_BASE_URL}/api/xp`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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

    return NextResponse.json({
      xp: Math.max(0, Math.trunc(xp)),
      level: Math.max(1, Math.trunc(level)),
    });
  } catch {
    return NextResponse.json({ error: 'Canonical XP unavailable' }, { status: 502 });
  }
}
