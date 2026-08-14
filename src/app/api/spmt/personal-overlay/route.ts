import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, SPMT_BASE_URL } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const response = await fetch(`${SPMT_BASE_URL}/api/tenant-scene?output=personal`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json({ error: payload?.error || 'Personal overlay unavailable' }, { status: response.status });
    }

    return NextResponse.json({
      tenant: typeof payload?.tenant === 'string' ? payload.tenant : null,
      output: 'personal',
      layout: payload?.layout && typeof payload.layout === 'object' ? payload.layout : null,
      updatedAt: payload?.updatedAt || null,
    });
  } catch {
    return NextResponse.json({ error: 'Personal overlay unavailable' }, { status: 502 });
  }
}
