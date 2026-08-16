import { NextRequest, NextResponse } from 'next/server';
import { OwnerDmDeliveryError, sendOwnerDiscordDm } from '@/lib/owner-dm-service';

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const expected = String(process.env.SPMT_API_KEY || process.env.SPMT_PLATFORM_API_KEY || '').trim();
  const provided = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && provided && provided === expected);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const delivered = await sendOwnerDiscordDm(body || {});
    return NextResponse.json({ success: true, ...delivered });
  } catch (error) {
    if (error instanceof OwnerDmDeliveryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[owner-dm] internal failure:', error);
    return NextResponse.json({ error: 'Internal owner DM error.' }, { status: 500 });
  }
}
