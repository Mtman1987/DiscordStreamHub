import { NextRequest, NextResponse } from 'next/server';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !/^\d{16,22}$/.test(String(body.userId || '')) || !['probe', 'start', 'stop', 'cancel', 'result'].includes(body.action)) return NextResponse.json({ error: 'Invalid capture request' }, { status: 400 });
  try {
    const response = await fetch('http://127.0.0.1:3091/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: body.action, userId: body.userId, id: body.id }), signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return NextResponse.json({ error: 'Discord voice listener is unavailable. Try again shortly.' }, { status: 503 }); }
}
