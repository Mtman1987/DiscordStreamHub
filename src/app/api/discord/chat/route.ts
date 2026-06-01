import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { awardPoints } from '@/lib/points-service';
import { handleSpmtCommand } from '@/lib/chat-tag-service';
// watch-request-service moved to hearmeout
const handleWatchRequestCommand = async (...args: any[]) => null;
const parseWatchAcceptCommand = (s: string) => null;
const parseWatchCommand = (s: string) => null;

const COOLDOWN_MS = 5 * 60 * 1000; // 1 point per 5 min per user
const discordChatCooldowns = new Map<string, number>();
const processedDiscordMessages = new Map<string, number>();
const CHAT_TAG_SERVICE_SECRET = process.env.CHAT_TAG_BOT_SECRET || process.env.BOT_SECRET_KEY || '1234';
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;

type FanoutTarget = {
  name: string;
  url: string;
};

function isWatchOrControlCommand(message: string) {
  return /^!(wr|watch)(?:\s|$)/i.test(message)
    || /^!(add|accept|controls?|watch-controls)$/i.test(message.trim());
}

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function discordChatUrl(baseUrl: string, override?: string) {
  if (override) return override;
  return `${baseUrl.replace(/\/$/, '')}/api/discord/chat`;
}

function shouldFanoutDiscordChat() {
  return process.env.DISCORD_CHAT_FANOUT === 'true';
}

function getFanoutTargets(): FanoutTarget[] {
  const targets = [
    {
      name: 'hearmeout',
      url: discordChatUrl(
        process.env.HEARMEOUT_URL || 'https://hearmeout-main.fly.dev',
        process.env.HEARMEOUT_DISCORD_CHAT_URL
      ),
    },
    {
      name: 'streamweaver',
      url: discordChatUrl(
        process.env.STREAMWEAVER_URL || process.env.STREAMWEAVE_URL || 'https://streamweaver-new.fly.dev',
        process.env.STREAMWEAVER_DISCORD_CHAT_URL
      ),
    },
  ];

  const seen = new Set<string>();
  return targets.filter((target) => {
    if (!target.url || seen.has(target.url)) return false;
    seen.add(target.url);
    return true;
  });
}

function markDiscordMessageSeen(guildId: string, channelId: string, messageId: string) {
  if (!messageId || !channelId) return false;

  const now = Date.now();
  for (const [key, seenAt] of processedDiscordMessages) {
    if (now - seenAt > PROCESSED_MESSAGE_TTL_MS) {
      processedDiscordMessages.delete(key);
    }
  }

  const key = `${guildId}:${channelId}:${messageId}`;
  if (processedDiscordMessages.has(key)) return true;
  processedDiscordMessages.set(key, now);
  return false;
}

async function postDiscordChat(target: FanoutTarget, body: any) {
  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-chat-origin': 'dsh-fanout',
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(15_000),
    });
    const payload = await response.json().catch(() => null);
    return {
      name: target.name,
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error: any) {
    return {
      name: target.name,
      ok: false,
      status: 0,
      payload: { success: false, error: error?.message || 'fanout failed' },
    };
  }
}

async function fanoutDiscordChat(body: any, message: string) {
  if (!shouldFanoutDiscordChat()) {
    return [];
  }

  const targets = isWatchOrControlCommand(message)
    ? getFanoutTargets().filter((target) => target.name === 'hearmeout')
    : getFanoutTargets();
  return Promise.all(targets.map((target) => postDiscordChat(target, body)));
}

async function sendDiscordChannelMessage(channelId: string, payload: any) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is not configured');

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord message failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function deleteDiscordMessage(channelId: string, messageId: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken || !channelId || !messageId) return { ok: false, skipped: true };
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${botToken}` },
  }).catch(() => null);
  return { ok: Boolean(response?.ok), status: response?.status || 0 };
}

function buildHearMeOutControlsPayload(joinUrl?: string) {
  return {
    content: '',
    embeds: [{
      title: 'HearMeOut Watch Controls',
      description: joinUrl ? `[Join the Discord Activity](${joinUrl})` : 'Control the shared HearMeOut watch room.',
      color: 0x22c55e,
      footer: { text: 'Controls update the shared Activity playback.' },
    }],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Play', custom_id: 'hmo_watch_control:play', emoji: { name: '▶️' } },
          { type: 2, style: 2, label: 'Pause', custom_id: 'hmo_watch_control:pause', emoji: { name: '⏸️' } },
          { type: 2, style: 2, label: 'Mute', custom_id: 'hmo_watch_control:mute', emoji: { name: '🔇' } },
          { type: 2, style: 2, label: 'Unmute', custom_id: 'hmo_watch_control:unmute', emoji: { name: '🔊' } },
          { type: 2, style: 1, label: 'Next', custom_id: 'hmo_watch_control:next', emoji: { name: '⏭️' } },
        ],
      },
      {
        type: 1,
        components: [
          ...(joinUrl ? [{ type: 2, style: 5, label: 'Join Activity', url: joinUrl, emoji: { name: '🎬' } }] : []),
          { type: 2, style: 4, label: 'Clear', custom_id: 'hmo_watch_control:clear', emoji: { name: '🧹' } },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function sendHearMeOutControls(channelId: string) {
  const payload = buildHearMeOutControlsPayload(`${process.env.HEARMEOUT_URL || 'https://hearmeout-main.fly.dev'}/activity`);
  return sendDiscordChannelMessage(channelId, payload);
}

function getHearMeOutFanoutReplies(fanout: any[]) {
  const hmo = fanout.find((target) => target?.name === 'hearmeout');
  const replies = hmo?.payload?.replies;
  if (Array.isArray(replies)) return replies;
  return hmo?.payload?.reply ? [hmo.payload.reply] : [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      const raw = await request.text();
      body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
    } catch (error) {
      console.error('[DiscordChat] Invalid JSON payload:', error);
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    console.log('[DiscordChat] Received:', JSON.stringify(body).slice(0, 200));

    // Support Kite format (may nest under 'root'), direct format, and old format
    const data = body.root || body;
    const user = data.user || data.author || data.member?.user || {};
    const channel = data.channel || {};
    const guild = data.guild || data.server || {};
    const userId = firstString(data.userId, data.user_id, data.discordUserId, data.discord_user_id, user.id);
    const guildId = firstString(data.guildId, data.guild_id, data.serverId, data.server_id, guild.id, process.env.HARDCODED_GUILD_ID);
    const userName = firstString(data.userName, data.user_name, data.displayName, data.display_name, data.username, user.username, user.global_name) || 'Unknown';
    const userAvatar = firstString(data.userAvatar, data.user_avatar, data.avatarUrl, data.avatar_url, user.avatar);
    const message = data.message || data.content || '';
    const channelId = firstString(data.channelId, data.channel_id, data.discordChannelId, data.discord_channel_id, channel.id);
    const messageId = firstString(data.messageId, data.message_id, data.discordMessageId, data.discord_message_id, data.id);
    const dispatch = data.dispatch !== false;
    const isDirectMessage = Boolean(
      data.isDM ||
      data.isDirectMessage ||
      data.is_direct_message ||
      channel.type === 'DM' ||
      channel.type === 1 ||
      channel.type === '1' ||
      !guild.id
    );

    if (!userId || !guildId) {
      return NextResponse.json({ error: 'userId and guildId required' }, { status: 400 });
    }

    if (!message || message.length === 0) {
      return NextResponse.json({ success: true, skipped: 'empty message' });
    }

    if (markDiscordMessageSeen(guildId, channelId, messageId)) {
      console.log(`[DiscordChat] Duplicate message ignored: ${guildId}/${channelId}/${messageId}`);
      return NextResponse.json({ success: true, skipped: 'duplicate-message', messageId });
    }

    const msgLower = message.toLowerCase();
    const isBotAuthor = Boolean(data.author?.bot || data.user?.bot || data.member?.user?.bot);

    if (dispatch && !isDirectMessage && channelId && guildId && messageId && !isBotAuthor) {
      void fetch(`${request.nextUrl.origin}/api/discord/forward-to-forum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildId,
          channelId,
          messageId,
          userId,
          userName,
          userAvatar,
          message,
        }),
      }).catch((error) => {
        console.warn('[DiscordChat] Forum forward request failed:', error?.message || error);
      });
    }

    if (/^!(controls?|watch-controls)$/i.test(message.trim()) && channelId) {
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      try {
        await sendHearMeOutControls(channelId);
        return NextResponse.json({ success: true, commandHandled: 'hearmeout-controls', delivery: 'channel', deletedCommand });
      } catch (error: any) {
        const fallback = await sendDiscordChannelMessage(channelId, {
          ...buildHearMeOutControlsPayload(`${process.env.HEARMEOUT_URL || 'https://hearmeout-main.fly.dev'}/activity`),
          content: `<@${userId}> here are the controls.` ,
          allowed_mentions: { parse: [], users: userId ? [userId] : [] },
        });
        return NextResponse.json({
          success: true,
          commandHandled: 'hearmeout-controls',
          delivery: 'channel-fallback',
          deletedCommand,
          fallback,
          dmError: error?.message || 'DM failed',
        });
      }
    }

    const fanoutPromise = fanoutDiscordChat(body, message);

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
        const fanout = await fanoutPromise;
        return NextResponse.json({ success: true, commandHandled: 'watch-request', fanout });
      }
      console.log(`[DiscordChat] Watch request command skipped because DISCORD_CHAT_HANDLE_WATCH is not true: ${message}`);
      const fanout = await fanoutPromise;
      const replies = getHearMeOutFanoutReplies(fanout);
      const discordSends = await Promise.all(replies.map((reply) => sendDiscordChannelMessage(
        channelId,
        typeof reply === 'string' ? { content: reply, allowed_mentions: { parse: [] } } : reply
      )));
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      return NextResponse.json({ success: true, skipped: 'watch-command-handled-by-voice-bot', fanout, discordSends, deletedCommand });
    }

    // Chat Tag: detect spmt commands, with legacy mention compatibility.
    const isSpmtCommand = /^@?spmt\s+/.test(msgLower) || message.startsWith('<@1279582181768957963>');
    if (isSpmtCommand && channelId) {
      // Normalize the message to the current spmt command form.
      let normalizedMsg = message;
      if (message.startsWith('<@')) {
        normalizedMsg = 'spmt ' + message.replace(/<@!?\d+>/g, '').trim();
      } else if (msgLower.startsWith('spmt ')) {
        normalizedMsg = 'spmt ' + message.substring(5);
      } else if (/^@?spmt\s+/.test(msgLower)) {
        normalizedMsg = 'spmt ' + message.substring(6);
      }
      const normalizedLower = normalizedMsg.toLowerCase().trim();
      if (normalizedLower === 'spmt embed' || normalizedLower === 'spmt panel') {
        try {
          const { postOrUpdateGameEmbed } = await import('@/lib/chat-tag-service');
          await postOrUpdateGameEmbed(guildId, channelId);
          await sendDiscordChannelMessage(channelId, { content: '✅ Chat Tag embed refreshed.' });
        } catch (err) {
          console.error('[DiscordChat] Chat Tag embed refresh failed:', err);
          await sendDiscordChannelMessage(channelId, { content: '❌ Chat Tag embed refresh failed. Check DSH logs.' }).catch(() => {});
        }
        const fanout = await fanoutPromise;
        return NextResponse.json({ success: true, commandHandled: 'chat-tag-embed-refresh', fanout });
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
      console.log(`[DiscordChat] spmt command detected from ${userName}: ${normalizedMsg} (channelId: ${channelId})`);
      try {
        await handleSpmtCommand(normalizedMsg, userId, userName, guildId, channelId, messageId);
      } catch (err: any) {
        console.error('[DiscordChat] spmt handler error:', err);
        await sendDiscordChannelMessage(channelId, {
          content: `❌ Chat Tag command failed: ${err?.message || 'unknown error'}`,
          allowed_mentions: { parse: [] },
        }).catch(() => {});
      }
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      const fanout = await fanoutPromise;
      return NextResponse.json({ success: true, commandHandled: 'chat-tag', channelId, messageId, deletedCommand, fanout });
    }

    // Check if user is in our community
    const userDoc = await db.collection('servers').doc(guildId).collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`[DiscordChat] ${userName} (${userId}) not in community DB, skipping points`);
      const fanout = await fanoutPromise;
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'not-a-member', fanout });
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
      const fanout = await fanoutPromise;
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'cooldown', fanout });
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
      const fanout = await fanoutPromise;
      return NextResponse.json({ success: true, pointsAwarded: true, points: result.pointsAwarded, fanout });
    } catch (pointsError) {
      console.error('[DiscordChat] awardPoints failed:', pointsError);
      const fanout = await fanoutPromise;
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'award-error', fanout });
    }
  } catch (error) {
    console.error('[DiscordChat] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
