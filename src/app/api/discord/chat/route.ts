import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { awardPoints } from '@/lib/points-service';
import { handleSpmtCommand } from '@/lib/chat-tag-service';
import { handleWatchRequestCommand, parseWatchAcceptCommand, parseWatchCommand } from '@/lib/watch-request-service';

const COOLDOWN_MS = 5 * 60 * 1000; // 1 point per 5 min per user
const discordChatCooldowns = new Map<string, number>();
const CHAT_TAG_SERVICE_SECRET = process.env.CHAT_TAG_BOT_SECRET || process.env.BOT_SECRET_KEY || '1234';

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      // Handle messages with control characters that break JSON
      const raw = await request.text();
      body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
    }
    console.log('[DiscordChat] Received:', JSON.stringify(body).slice(0, 200));

    // Support Kite format (may nest under 'root'), direct format, and old format
    const data = body.root || body;
    const userId = data.userId;
    const guildId = data.guildId || data.serverId || process.env.HARDCODED_GUILD_ID;
    const userName = data.userName || data.displayName || data.username || 'Unknown';
    const userAvatar = data.userAvatar || data.avatarUrl || '';
    const message = data.message || data.content || '';
    const channelId = data.channelId || '';
    const messageId = data.messageId || '';

    if (!userId || !guildId) {
      return NextResponse.json({ error: 'userId and guildId required' }, { status: 400 });
    }

    if (!message || message.length === 0) {
      return NextResponse.json({ success: true, skipped: 'empty message' });
    }

    const watchCommand = parseWatchCommand(message) || parseWatchAcceptCommand(message);
    if (watchCommand && channelId) {
      if (process.env.DISCORD_CHAT_HANDLE_WATCH === 'true') {
        console.log(`[DiscordChat] Watch request command detected from ${userName}: ${message} (channelId: ${channelId})`);
        await handleWatchRequestCommand({
          message,
          discordUserId: userId,
          discordUserName: userName,
          guildId,
          channelId,
          userMessageId: messageId,
          publicBaseUrl: request.nextUrl.origin,
        });
        return NextResponse.json({ success: true, commandHandled: 'watch-request' });
      }
      console.log(`[DiscordChat] Watch request command skipped because DISCORD_CHAT_HANDLE_WATCH is not true: ${message}`);
      return NextResponse.json({ success: true, skipped: 'watch-command-handled-by-voice-bot' });
    }

    // Chat Tag: detect @spmt or spmt commands (Discord converts @spmt to <@botId>)
    const msgLower = message.toLowerCase();
    const isSpmtCommand = msgLower.startsWith('spmt ') || msgLower.startsWith('@spmt ') || message.startsWith('<@1279582181768957963>');
    if (isSpmtCommand && channelId) {
      // Normalize the message to always start with @spmt
      let normalizedMsg = message;
      if (message.startsWith('<@')) {
        normalizedMsg = '@spmt ' + message.replace(/<@!?\d+>/g, '').trim();
      } else if (msgLower.startsWith('spmt ')) {
        normalizedMsg = '@spmt ' + message.substring(5);
      }
      // Replace Discord user mentions with usernames for target resolution
      const mentionPattern = /<@!?(\d+)>/g;
      let match;
      while ((match = mentionPattern.exec(normalizedMsg)) !== null) {
        try {
          const mentionedDoc = await db.collection('servers').doc(guildId).collection('users').doc(match[1]).get();
          const twitchName = mentionedDoc.data()?.twitchLogin || mentionedDoc.data()?.username;
          if (twitchName) normalizedMsg = normalizedMsg.replace(match[0], twitchName);
        } catch {}
      }
      console.log(`[DiscordChat] @spmt command detected from ${userName}: ${normalizedMsg} (channelId: ${channelId})`);
      handleSpmtCommand(normalizedMsg, userId, userName, guildId, channelId, messageId).catch(err =>
        console.error('[DiscordChat] @spmt handler error:', err)
      );
    }

    // Check if user is in our community
    const userDoc = await db.collection('servers').doc(guildId).collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`[DiscordChat] ${userName} (${userId}) not in community DB, skipping points`);
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'not-a-member' });
    }

    // Track Discord chat activity in chat-tag (auto-wake, lastSeenChannel)
    const twitchLogin = userDoc.data()?.twitchLogin;
    if (twitchLogin) {
      const tagData = await (async () => {
        try {
          const r = await fetch(`${process.env.CHAT_TAG_API_BASE || 'https://chat-tag-new.fly.dev'}/api/tag`);
          return r.ok ? await r.json() : null;
        } catch { return null; }
      })();
      const player = tagData?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin.toLowerCase());
      if (player) {
        fetch(`${process.env.CHAT_TAG_API_BASE || 'https://chat-tag-new.fly.dev'}/api/tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': CHAT_TAG_SERVICE_SECRET },
          body: JSON.stringify({ action: 'chat-activity', userId: player.id, twitchUsername: twitchLogin, channel: 'discord' }),
        }).catch(() => {});
      }
    }

    // Rate limit: 1 point per 5 min per user
    const now = Date.now();
    const lastAwarded = discordChatCooldowns.get(userId);
    if (lastAwarded && now - lastAwarded < COOLDOWN_MS) {
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'cooldown' });
    }
    discordChatCooldowns.set(userId, now);

    // Award points
    try {
      const result = await awardPoints({
        serverId: guildId,
        userId,
        eventType: 'chat_activity',
        quantity: 1,
        source: 'discord',
        metadata: { username: userName, channelId, avatarUrl: userAvatar }
      });
      console.log(`[DiscordChat] Awarded ${result.pointsAwarded} pts to ${userName}`);
      return NextResponse.json({ success: true, pointsAwarded: true, points: result.pointsAwarded });
    } catch (pointsError) {
      console.error('[DiscordChat] awardPoints failed:', pointsError);
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'award-error' });
    }
  } catch (error) {
    console.error('[DiscordChat] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
