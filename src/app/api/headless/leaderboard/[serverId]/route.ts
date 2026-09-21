import { NextResponse } from 'next/server';
import { getSpmtXpLeaderboard } from '@/lib/spmt-client';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const { serverId } = await params;
    if (!String(serverId || '').trim()) return NextResponse.json({ entries: [] });

    const canonical = await getSpmtXpLeaderboard(10);
    const entries = canonical.map((entry) => ({
      username: entry.displayName || entry.username || entry.userId,
      points: Number(entry.lifetimeXp || 0),
      currentPoints: Number(entry.spendableXp || 0),
      rank: entry.rank,
      avatarUrl: entry.avatarUrl || 'https://spacemountain.live/assets/space-logo-main.png',
      userId: entry.userId,
      source: 'spmt',
    }));

    return NextResponse.json({ entries }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[headless leaderboard] failed to load canonical SPMT XP:', error);
    return NextResponse.json({ entries: [], error: 'Leaderboard unavailable' }, { status: 200 });
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}
