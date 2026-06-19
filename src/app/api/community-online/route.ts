import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

const HARDCODED_SERVER_ID = getHardcodedGuildId();

// Returns community members who are currently live on Twitch
// Used by HearMeOut to show "Live on Twitch" in the sidebar
export async function GET() {
  try {
    const usersSnap = await db.collection('servers').doc(HARDCODED_SERVER_ID).collection('users')
      .where('isOnline', '==', true)
      .get();

    const liveUsers = usersSnap.docs.map((doc: { id: string; data: () => any }) => {
      const data = doc.data();
      return {
        id: doc.id,
        username: data.username || data.displayName || data.twitchLogin || 'Unknown',
        twitchLogin: data.twitchLogin || null,
        avatarUrl: data.avatarUrl || null,
        group: data.group || 'Community',
      };
    });

    return NextResponse.json({
      source: 'discord-stream-hub',
      count: liveUsers.length,
      users: liveUsers,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=30',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, users: [] }, { status: 500 });
  }
}
