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

    // Keep live playback independent of Discord message/artwork rotation.
    // An offline saved record must not blank the player while others are live.
    const liveSelection = spotlightUser || users.slice().sort((a: LiveCommunityUser, b: LiveCommunityUser) => String(a.twitchLogin).localeCompare(String(b.twitchLogin)))[Math.floor(Date.now() / 600_000) % Math.max(1, users.length)];
    const selectedData = spotlightUser ? spotlightData : null;

    return NextResponse.json({
      source: 'discord-stream-hub',
      serverId: SERVER_ID,
      count: users.length,
      users,
      // Never expose a stale/offline spotlight record to the browser-source
      // player. A full-screen Twitch embed for an offline channel paints an
      // opaque black surface over the rest of the Community Lounge.
      spotlight: liveSelection ? {
        userId: liveSelection.id,
        twitchLogin: liveSelection.twitchLogin,
        gifUrl: selectedData?.gifUrl || selectedData?.cardGifUrl || null,
        avatarUrl: selectedData?.avatarUrl || liveSelection.avatarUrl || null,
        streamTitle: liveSelection.streamTitle || selectedData?.streamTitle || null,
        gameTitle: liveSelection.gameName || selectedData?.gameTitle || null,
        viewerCount: liveSelection.viewerCount ?? selectedData?.viewerCount ?? null,
        group: liveSelection.group || selectedData?.group || null,
        currentIndex: selectedData?.currentIndex ?? null,
        updatedAt: selectedData?.updatedAt || selectedData?.lastUpdatedAt || null,
        user: liveSelection,
      } : null,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, users: [], spotlight: null }, { status: 500 });
  }
}
