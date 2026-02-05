import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { db } from '@/firebase/server-init';
import { verifyKey } from 'discord-interactions';

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const rawBody = await request.text();

    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 });
    }

    const isValid = verifyKey(rawBody, signature, timestamp, process.env.DISCORD_PUBLIC_KEY!);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    if (body.type === 1) {
      return NextResponse.json({ type: 1 });
    }

    if (body.type === 3 && body.data.custom_id === 'check_rank') {
      const userId = body.member?.user?.id || body.user?.id;
      const guildId = body.guild_id;

      if (!userId || !guildId) {
        return NextResponse.json({
          type: 4,
          data: {
            content: 'Unable to identify user or server.',
            flags: 64,
          },
        });
      }

      const usersSnapshot = await db.collection('servers').doc(guildId).collection('users').where('discordUserId', '==', userId).limit(1).get();

      if (usersSnapshot.empty) {
        return NextResponse.json({
          type: 4,
          data: {
            content: 'You are not in the leaderboard yet. Start participating to earn points!',
            flags: 64,
          },
        });
      }

      const userProfileId = usersSnapshot.docs[0].id;
      const leaderboardDoc = await db.collection('servers').doc(guildId).collection('leaderboard').doc(userProfileId).get();

      if (!leaderboardDoc.exists) {
        return NextResponse.json({
          type: 4,
          data: {
            content: 'You have no points yet. Start participating to earn points!',
            flags: 64,
          },
        });
      }

      const userPoints = leaderboardDoc.data()?.points || 0;
      const allLeaderboard = await db.collection('servers').doc(guildId).collection('leaderboard').orderBy('points', 'desc').get();
      const rank = allLeaderboard.docs.findIndex((doc) => doc.id === userProfileId) + 1;

      return NextResponse.json({
        type: 4,
        data: {
          content: `🏆 **Your Rank:** #${rank}\n📊 **Total Points:** ${userPoints.toLocaleString()}`,
          flags: 64,
        },
      });
    }

    return NextResponse.json({ error: 'Unknown interaction' }, { status: 400 });
  } catch (error) {
    console.error('Interaction error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
