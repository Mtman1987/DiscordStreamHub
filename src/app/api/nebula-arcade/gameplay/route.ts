import { NextRequest, NextResponse } from 'next/server';
import {
  getNebulaGameplayFallbackUrl,
  getNebulaGameplayItems,
  getNebulaGameplaySlot,
  resolveNebulaGameplayNow,
  selectNebulaGameplay,
} from '@/lib/nebula-gameplay-rotation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const now = resolveNebulaGameplayNow(request.nextUrl.searchParams.get('slot'));
  const items = await getNebulaGameplayItems();
  const active = selectNebulaGameplay(items, now);

  return NextResponse.json({
    slot: getNebulaGameplaySlot(now),
    rotationSeconds: 10 * 60,
    active,
    availableGames: items.length,
    fallbackImageUrl: getNebulaGameplayFallbackUrl(),
    nextChangeAt: new Date((getNebulaGameplaySlot(now) + 1) * 10 * 60 * 1000).toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
