import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE } from '@/lib/spmt-session';
import { removeSignalShoutoutFromWebControl } from '@/lib/signal-shoutout-control';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const controlToken = String(body.controlToken || body.token || '').trim();
  const spmtAccessToken = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!controlToken) {
    return NextResponse.json({ ok: false, error: 'Missing Signal control token' }, { status: 400 });
  }
  if (!spmtAccessToken) {
    return NextResponse.json({ ok: false, error: 'SPMT session required' }, { status: 401 });
  }

  const result = await removeSignalShoutoutFromWebControl({ controlToken, spmtAccessToken });
  return NextResponse.json(result, { status: result.ok ? 200 : result.authorized ? 400 : 403 });
}
