import { NextRequest, NextResponse } from 'next/server';
import {
  getNebulaGameplayFallbackUrl,
  getNebulaGameplayItems,
  selectNebulaGameplay,
} from '@/lib/nebula-gameplay-rotation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestedSlot = Number(request.nextUrl.searchParams.get('slot'));
  const now = Number.isFinite(requestedSlot) && requestedSlot >= 0
    ? requestedSlot * 10 * 60 * 1000
    : Date.now();
  const active = selectNebulaGameplay(await getNebulaGameplayItems(), now);
  const target = active?.mediaUrl || getNebulaGameplayFallbackUrl();
  return NextResponse.redirect(target, {
    status: 307,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
