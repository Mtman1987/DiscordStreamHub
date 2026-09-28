import { NextResponse } from 'next/server';
import { getSpmtXpLeaderboard } from '@/lib/spmt-client';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const { serverId } = await params;
    if (!String(serverId || '').trim()) return NextResponse.json({ entries: [] });

    const canonical = await getSpmtXpLeaderboard(10);
    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get().catch(() => ({ docs: [] as any[] }));
    const linkedUsers = (usersSnapshot.docs || []).map((doc: any) => ({ id: String(doc.id || ''), ...(doc.data?.() || {}) }));
    const bySpmtUserId = new Map<string, any>();
    const byTwitchLogin = new Map<string, any>();
    for (const user of linkedUsers) {
      const spmtUserId = String(user.spmtUserId || '').trim();
      const twitchLogin = String(user.twitchLogin || user.twitchUsername || '').trim().toLowerCase();
      if (spmtUserId) bySpmtUserId.set(spmtUserId, user);
      if (twitchLogin) byTwitchLogin.set(twitchLogin, user);
    }

    const entries = canonical.map((entry) => {
      const twitchLogin = String(entry.username || '').trim().toLowerCase();
      const linked = bySpmtUserId.get(String(entry.userId || '').trim()) || (twitchLogin ? byTwitchLogin.get(twitchLogin) : null);
      const discordUserId = linked ? String(linked.discordUserId || linked.id || '').trim() : '';
      const discordUsername = linked ? String(linked.username || linked.discordUsername || '').trim() : '';
      const discordDisplayName = linked ? String(linked.displayName || linked.discordDisplayName || discordUsername || '').trim() : '';
      const discordAvatar = linked ? String(linked.avatarUrl || linked.discordAvatar || '').trim() : '';
      return {
        username: discordDisplayName || entry.displayName || entry.username || entry.userId,
        discordUsername: discordUserId ? discordUsername : '',
        discordUserId,
        twitchUsername: entry.username || '',
        points: Number(entry.lifetimeXp || 0),
        currentPoints: Number(entry.spendableXp || 0),
        rank: entry.rank,
        avatarUrl: discordUserId && discordAvatar
          ? discordAvatar
          : entry.avatarUrl || 'https://spacemountain.live/assets/space-logo-main.png',
        userId: entry.userId,
        source: discordUserId ? 'discord-linked' : 'spmt',
      };
    });

    return NextResponse.json({ entries }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[headless leaderboard] failed to load canonical SPMT XP:', error);
    return NextResponse.json({ entries: [], error: 'Leaderboard unavailable' }, { status: 200 });
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}
