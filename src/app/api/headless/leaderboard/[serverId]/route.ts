import { NextResponse } from 'next/server';
import { db } from '@/data/server-init';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const { serverId } = await params;
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) return NextResponse.json({ entries: [] });

    const [leaderboardSnapshot, usersSnapshot] = await Promise.all([
      db.collection('servers').doc(normalizedServerId).collection('leaderboard').orderBy('points', 'desc').limit(10).get(),
      db.collection('servers').doc(normalizedServerId).collection('users').get(),
    ]);

    const usersById = new Map<string, Record<string, any>>();
    for (const doc of usersSnapshot.docs) {
      const user = doc.data() || {};
      // Leaderboard records can use the app profile ID, Discord ID, or
      // linked Twitch ID. Index all identities already stored in DSH.
      const identities = [doc.id, user.id, user.discordUserId, user.twitchId, user.twitchUserId]
        .filter(Boolean)
        .map(String);
      for (const identity of identities) usersById.set(identity, user);
    }

    const entries = leaderboardSnapshot.docs.map((doc: any, index: number) => {
      const entry = doc.data() || {};
      const user = usersById.get(String(entry.userProfileId || doc.id)) || {};
      return {
        username: user.twitchDisplayName || user.twitchLogin || user.displayName || user.username || String(entry.userProfileId || doc.id),
        points: Number(entry.points || 0),
        rank: index + 1,
        avatarUrl: user.twitchProfileImageUrl || user.avatarUrl || 'https://spacemountain.live/assets/space-logo-main.png',
      };
    });

    return NextResponse.json({ entries }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[headless leaderboard] failed to load:', error);
    return NextResponse.json({ entries: [], error: 'Leaderboard unavailable' }, { status: 200 });
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}
