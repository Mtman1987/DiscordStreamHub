import { NextRequest, NextResponse } from 'next/server';
import {
  getNebulaGameplayFallbackUrl,
  getNebulaGameplayItems,
  resolveNebulaGameplayNow,
  selectNebulaGameplay,
} from '@/lib/nebula-gameplay-rotation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const now = resolveNebulaGameplayNow(request.nextUrl.searchParams.get('slot'));
  const active = selectNebulaGameplay(await getNebulaGameplayItems(), now);
  const target = active?.mediaUrl || getNebulaGameplayFallbackUrl();
  return NextResponse.redirect(target, {
    status: 307,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
