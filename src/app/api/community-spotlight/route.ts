import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

const SERVER_ID = getHardcodedGuildId();
const SYSTEM_TWITCH_LOGINS = new Set(['spacemountainlive']);

type LiveCommunityUser = {
  id: string;
  username: string;
  twitchLogin: string | null;
  avatarUrl: string | null;
  group: string;
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
    const users = usersSnap.docs
      .map(mapUser)
      .filter((user) => user.twitchLogin && !SYSTEM_TWITCH_LOGINS.has(user.twitchLogin.toLowerCase()));

    const spotlightDoc = await db.collection('servers').doc(SERVER_ID).collection('spotlight').doc('current').get();
    const spotlightData = spotlightDoc.exists ? spotlightDoc.data() : null;
    const spotlightUser = spotlightData?.userId
      ? users.find((user: LiveCommunityUser) => user.id === spotlightData.userId)
      : users.find((user: LiveCommunityUser) => user.twitchLogin?.toLowerCase() === String(spotlightData?.twitchLogin || '').toLowerCase());
    const resolvedSpotlight = spotlightUser || users[0] || null;

    return NextResponse.json({
      source: 'discord-stream-hub',
      serverId: SERVER_ID,
      count: users.length,
      users,
      spotlight: resolvedSpotlight ? {
        userId: resolvedSpotlight.id,
        twitchLogin: resolvedSpotlight.twitchLogin,
        group: resolvedSpotlight.group,
        currentIndex: spotlightUser ? (spotlightData?.currentIndex ?? null) : null,
        updatedAt: spotlightUser ? (spotlightData?.updatedAt || spotlightData?.lastUpdatedAt || null) : null,
        user: resolvedSpotlight,
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
