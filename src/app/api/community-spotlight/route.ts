import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getStreamsByLogins } from '@/lib/twitch-api-service';

export const dynamic = 'force-dynamic';

const SERVER_ID = getHardcodedGuildId();

type LiveCommunityUser = {
  id: string;
  username: string;
  twitchLogin: string | null;
  avatarUrl: string | null;
  group: string;
  streamTitle?: string | null;
  gameName?: string | null;
  viewerCount?: number | null;
  startedAt?: string | null;
};

function mapUser(doc: { id: string; data: () => any }): LiveCommunityUser {
  const data = doc.data();
  return {
    id: doc.id,
    username: data.username || data.displayName || data.twitchLogin || 'Unknown',
    twitchLogin: data.twitchLogin || null,
    avatarUrl: data.avatarUrl || null,
    group: data.group || 'Community',
  };
}

export async function GET() {
  try {
    const usersSnap = await db.collection('servers').doc(SERVER_ID).collection('users')
      .where('isOnline', '==', true)
      .get();
    const candidates = usersSnap.docs.map(mapUser);
    const logins = candidates.map((user: LiveCommunityUser) => String(user.twitchLogin || '').trim()).filter(Boolean);
    const liveByLogin = logins.length ? await getStreamsByLogins(logins) : new Map<string, any>();
    const users = candidates
      .map((user: LiveCommunityUser) => {
        const login = String(user.twitchLogin || '').toLowerCase();
        const stream = login ? liveByLogin.get(login) : null;
        if (!stream) return null;
        return {
          ...user,
          streamTitle: stream.title || null,
          gameName: stream.game_name || null,
          viewerCount: Number.isFinite(Number(stream.viewer_count)) ? Number(stream.viewer_count) : null,
          startedAt: stream.started_at || null,
        };
      })
      .filter((user: LiveCommunityUser | null): user is LiveCommunityUser => Boolean(user));

    const spotlightDoc = await db.collection('servers').doc(SERVER_ID).collection('spotlight').doc('current').get();
    const spotlightData = spotlightDoc.exists ? spotlightDoc.data() : null;
    const spotlightUser = spotlightData?.userId
      ? users.find((user: LiveCommunityUser) => user.id === spotlightData.userId)
      : users.find((user: LiveCommunityUser) => user.twitchLogin?.toLowerCase() === String(spotlightData?.twitchLogin || '').toLowerCase());

    return NextResponse.json({
      source: 'discord-stream-hub',
      serverId: SERVER_ID,
      count: users.length,
      users,
      // Never expose a stale/offline spotlight record to the browser-source
      // player. A full-screen Twitch embed for an offline channel paints an
      // opaque black surface over the rest of the Community Lounge.
      spotlight: spotlightData && spotlightUser ? {
        userId: spotlightUser.id,
        twitchLogin: spotlightUser.twitchLogin,
        gifUrl: spotlightData.gifUrl || spotlightData.cardGifUrl || null,
        avatarUrl: spotlightData.avatarUrl || spotlightUser.avatarUrl || null,
        streamTitle: spotlightUser.streamTitle || spotlightData.streamTitle || null,
        gameTitle: spotlightUser.gameName || spotlightData.gameTitle || null,
        viewerCount: spotlightUser.viewerCount ?? spotlightData.viewerCount ?? null,
        group: spotlightUser.group || spotlightData.group || null,
        currentIndex: spotlightData.currentIndex ?? null,
        updatedAt: spotlightData.updatedAt || spotlightData.lastUpdatedAt || null,
        user: spotlightUser,
      } : null,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=30',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, users: [], spotlight: null }, { status: 500 });
  }
}
