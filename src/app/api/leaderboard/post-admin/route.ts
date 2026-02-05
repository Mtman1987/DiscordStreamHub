import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { db } from '@/firebase/server-init';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId } = await request.json();

    if (!serverId || !channelId) {
      return NextResponse.json({ success: false, error: 'Missing serverId or channelId' }, { status: 400 });
    }

    const leaderboardSnapshot = await db
      .collection('servers')
      .doc(serverId)
      .collection('adminLeaderboard')
      .orderBy('points', 'desc')
      .limit(10)
      .get();

    const leaderboardData = await Promise.all(
      leaderboardSnapshot.docs.map(async (doc, index) => {
        const data = doc.data();
        const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(data.userProfileId).get();
        const userData = userDoc.data();
        return {
          rank: index + 1,
          username: userData?.username || 'Unknown',
          points: data.points || 0,
        };
      })
    );

    const embed = {
      title: '⭐ Admin Leaderboard - Top 10',
      description: 'Top contributors through calendar events, captain\'s logs, and admin activities!',
      color: 0xffa500,
      fields: leaderboardData.map((entry) => ({
        name: `${entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`} ${entry.username}`,
        value: `${entry.points.toLocaleString()} admin points`,
        inline: false,
      })),
      footer: { text: 'Admin points are earned from calendar and community management activities' },
      timestamp: new Date().toISOString(),
    };

    const botToken = process.env.DISCORD_BOT_TOKEN;
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${error}`);
    }

    return NextResponse.json({ success: true, message: 'Admin leaderboard posted to Discord' });
  } catch (error) {
    console.error('Failed to post admin leaderboard:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
