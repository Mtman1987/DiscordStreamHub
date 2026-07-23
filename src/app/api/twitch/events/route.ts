import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { awardPoints } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';

const CHAT_COOLDOWN_MS = 5 * 60 * 1000;
const chatCooldowns = new Map<string, number>();

// POST /api/twitch/events
// Chat-tag forwards Twitch events here for points tracking
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, serverId: providedServerId, twitchLogin, twitchId, username, channel, viewers, bits, recipient } = body;
    const serverId = providedServerId || getHardcodedGuildId();

    if (!type || !twitchLogin) {
      return NextResponse.json({ error: 'type and twitchLogin required' }, { status: 400 });
    }

    // Look up Discord user ID from twitchLogin
    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users')
      .where('twitchLogin', '==', twitchLogin.toLowerCase()).limit(1).get();

    if (usersSnapshot.empty) {
      return NextResponse.json({ success: true, skipped: true, reason: 'user-not-in-server' });
    }

    const discordUserId = usersSnapshot.docs[0].id;

    switch (type) {
      case 'chat': {
        const now = Date.now();
        const key = twitchId || twitchLogin;
        const last = chatCooldowns.get(key);
        if (last && now - last < CHAT_COOLDOWN_MS) {
          return NextResponse.json({ success: true, skipped: true, reason: 'cooldown' });
        }
        chatCooldowns.set(key, now);

        const result = await awardPoints({
          serverId, userId: discordUserId, eventType: 'chat_activity',
          quantity: 1, source: 'twitch',
          metadata: { username: username || twitchLogin, channel }
        });
        return NextResponse.json({ success: true, pointsAwarded: result.pointsAwarded });
      }

      case 'raid': {
        const result = await awardPoints({
          serverId, userId: discordUserId, eventType: 'raid',
          quantity: 1, source: 'twitch',
          metadata: { username: username || twitchLogin, channel, viewers }
        });
        console.log(`[TwitchEvents] Raid: ${twitchLogin} → ${channel} (${viewers} viewers) +${result.pointsAwarded}pts`);
        return NextResponse.json({ success: true, pointsAwarded: result.pointsAwarded });
      }

      case 'subscription':
      case 'resub': {
        const result = await awardPoints({
          serverId, userId: discordUserId, eventType: 'subscription',
          quantity: 1, source: 'twitch',
          metadata: { username: username || twitchLogin, channel }
        });
        console.log(`[TwitchEvents] Sub: ${twitchLogin} +${result.pointsAwarded}pts`);
        return NextResponse.json({ success: true, pointsAwarded: result.pointsAwarded });
      }

      case 'gift_sub':
      case 'subgift': {
        const giftCount = body.quantity || 1;
        const result = await awardPoints({
          serverId, userId: discordUserId, eventType: 'gifted_subscription',
          quantity: giftCount, source: 'twitch',
          metadata: { username: username || twitchLogin, channel, recipient, giftCount }
        });
        console.log(`[TwitchEvents] Gift sub: ${twitchLogin} x${giftCount} +${result.pointsAwarded}pts`);
        return NextResponse.json({ success: true, pointsAwarded: result.pointsAwarded });
      }

      case 'cheer': {
        const bitCount = parseInt(bits || '0');
        if (bitCount === 0) {
          return NextResponse.json({ success: true, skipped: true, reason: 'zero-bits' });
        }
        const result = await awardPoints({
          serverId, userId: discordUserId, eventType: 'bits',
          quantity: bitCount, source: 'twitch',
          metadata: { username: username || twitchLogin, channel, bits: bitCount }
        });
        console.log(`[TwitchEvents] Cheer: ${twitchLogin} ${bitCount} bits +${result.pointsAwarded}pts`);
        return NextResponse.json({ success: true, pointsAwarded: result.pointsAwarded });
      }

      case 'follow': {
        const result = await awardPoints({
          serverId, userId: discordUserId, eventType: 'follow',
          quantity: 1, source: 'twitch',
          metadata: { username: username || twitchLogin, channel }
        });
        console.log(`[TwitchEvents] Follow: ${twitchLogin} +${result.pointsAwarded}pts`);
        return NextResponse.json({ success: true, pointsAwarded: result.pointsAwarded });
      }

      default:
        return NextResponse.json({ success: true, skipped: true, reason: `unknown-type: ${type}` });
    }
  } catch (error) {
    console.error('[TwitchEvents] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
