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
    || /^!(add|accept|controls?|watch-controls|invite)$/i.test(message.trim());
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

async function createDiscordDmChannel(userId: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is not configured');

  const response = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!response.ok) {
    throw new Error(`Discord DM channel failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function getHearMeOutActivityUrl() {
  return `${(process.env.HEARMEOUT_URL || 'https://hearmeout-main.fly.dev').replace(/\/$/, '')}/activity`;
}

function getPublicBaseUrl(origin?: string) {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || origin || '').replace(/\/$/, '');
}

function getSpaceMountainIconUrl(origin?: string) {
  const configured = process.env.SPACE_MOUNTAIN_ICON_URL || process.env.DISCORD_AUTHOR_ICON_URL;
  if (configured) return configured;

  const baseUrl = getPublicBaseUrl(origin);
  return baseUrl ? `${baseUrl}/cosmicraid.png` : undefined;
}

function findJoinUrl(payload: any) {
  for (const row of payload?.components || []) {
    for (const component of row?.components || []) {
      if (component?.type === 2 && component?.style === 5 && typeof component?.url === 'string') {
        const label = String(component.label || '').toLowerCase();
        if (label.includes('join') || component.url.includes('/activity') || component.url.includes('discord.gg')) {
          return component.url;
        }
      }
    }
  }

  for (const embed of payload?.embeds || []) {
    if (typeof embed?.url === 'string' && (embed.url.includes('/activity') || embed.url.includes('discord.gg'))) {
      return embed.url;
    }
  }

  return undefined;
}

function compactHearMeOutControls(components: any[] = []) {
  return components
    .map((row) => {
      const nextComponents = (row.components || [])
        .filter((component: any) => !(component?.type === 2 && component?.style === 5 && String(component.label || '').toLowerCase().includes('join')))
        .filter((component: any) => !['hmo_watch_control:play', 'hmo_watch_control:pause', 'hmo_watch_control:mute', 'hmo_watch_control:unmute'].includes(component?.custom_id));

      if ((row.components || []).some((component: any) => ['hmo_watch_control:play', 'hmo_watch_control:pause'].includes(component?.custom_id))) {
        nextComponents.unshift({ type: 2, style: 3, label: 'Play/Pause', custom_id: 'hmo_watch_control:play-pause', emoji: { name: '⏯️' } });
      }

      if ((row.components || []).some((component: any) => ['hmo_watch_control:mute', 'hmo_watch_control:unmute'].includes(component?.custom_id))) {
        const insertAt = nextComponents.findIndex((component: any) => component?.custom_id === 'hmo_watch_control:next');
        const muteButton = { type: 2, style: 2, label: 'Mute/Unmute', custom_id: 'hmo_watch_control:mute-unmute', emoji: { name: '🔇' } };
        if (insertAt >= 0) nextComponents.splice(insertAt, 0, muteButton);
        else nextComponents.push(muteButton);
      }

      return { ...row, components: nextComponents };
    })
    .flatMap((row) => row.components || [])
    .slice(0, 5);
}

function extractWatchTitle(payload: any) {
  const embed = payload?.embeds?.[0];
  const authorName = embed?.author?.name;
  if (authorName && authorName !== 'HearMeOut') return authorName;
  if (embed?.title && embed.title !== 'HearMeOut' && !String(embed.title).toLowerCase().includes('control')) return embed.title;

  const contentTitle = String(payload?.content || '').match(/\*\*([^*]+)\*\*/)?.[1];
  return contentTitle || undefined;
}

function normalizeHearMeOutReply(reply: any, origin?: string) {
  if (!reply || typeof reply === 'string') return reply;

  const payload = { ...reply };
  const joinUrl = findJoinUrl(payload);
  const watchTitle = extractWatchTitle(payload);
  const authorIcon = getSpaceMountainIconUrl(origin);
  const originalEmbed = payload.embeds?.[0] || {};

  payload.embeds = [{
    ...originalEmbed,
    title: 'HearMeOut',
    ...(joinUrl ? { url: joinUrl } : {}),
    ...(watchTitle ? { author: { name: watchTitle, ...(authorIcon ? { icon_url: authorIcon } : {}) } } : {}),
  }];

  const compactButtons = compactHearMeOutControls(payload.components || []);
  payload.components = compactButtons.length ? [{ type: 1, components: compactButtons }] : [];
  payload.allowed_mentions = payload.allowed_mentions || { parse: [] };
  return payload;
}

function buildHearMeOutControlsPayload(options: { joinUrl?: string; includeJoinPreview?: boolean; origin?: string } = {}) {
  const { joinUrl, includeJoinPreview = false, origin } = options;
  const authorIcon = getSpaceMountainIconUrl(origin);

  return {
    content: '',
    embeds: [{
      title: 'HearMeOut',
      ...(joinUrl && includeJoinPreview ? { url: joinUrl } : {}),
      description: 'Control the shared HearMeOut watch room.',
      color: 0x22c55e,
      author: { name: 'Watch Controls', ...(authorIcon ? { icon_url: authorIcon } : {}) },
      footer: { text: 'Controls update the shared Activity playback.' },
    }],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Play/Pause', custom_id: 'hmo_watch_control:play-pause', emoji: { name: '⏯️' } },
          { type: 2, style: 2, label: 'Mute/Unmute', custom_id: 'hmo_watch_control:mute-unmute', emoji: { name: '🔇' } },
          { type: 2, style: 1, label: 'Next', custom_id: 'hmo_watch_control:next', emoji: { name: '⏭️' } },
          { type: 2, style: 4, label: 'Clear', custom_id: 'hmo_watch_control:clear', emoji: { name: '🧹' } },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function sendHearMeOutControls(channelId: string, userId?: string, origin?: string) {
  const payload = buildHearMeOutControlsPayload({ origin });
  if (userId) {
    const dm = await createDiscordDmChannel(userId);
    if (dm?.id) return sendDiscordChannelMessage(dm.id, payload);
  }
  return sendDiscordChannelMessage(channelId, payload);
}

function getHearMeOutFanoutReplies(fanout: any[]) {
  const hmo = fanout.find((target) => target?.name === 'hearmeout');
  const replies = hmo?.payload?.replies;
  if (Array.isArray(replies)) return replies;
  return hmo?.payload?.reply ? [hmo.payload.reply] : [];
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

    if (markDiscordMessageSeen(guildId, channelId, messageId)) {
      console.log(`[DiscordChat] Duplicate message ignored: ${guildId}/${channelId}/${messageId}`);
      return NextResponse.json({ success: true, skipped: 'duplicate-message', messageId });
    }

    const msgLower = message.toLowerCase();

    if (/^!(controls?|watch-controls)$/i.test(message.trim()) && channelId) {
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      try {
        await sendHearMeOutControls(channelId, userId, request.nextUrl.origin);
        return NextResponse.json({ success: true, commandHandled: 'hearmeout-controls', delivery: userId ? 'dm' : 'channel', deletedCommand });
      } catch (error: any) {
        const fallback = await sendDiscordChannelMessage(channelId, {
          ...buildHearMeOutControlsPayload({ origin: request.nextUrl.origin }),
          content: userId ? `<@${userId}> I could not DM you, so here are the controls.` : '',
          allowed_mentions: { users: userId ? [userId] : [] },
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

    if (/^!invite$/i.test(message.trim()) && channelId) {
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      const payload = buildHearMeOutControlsPayload({
        joinUrl: getHearMeOutActivityUrl(),
        includeJoinPreview: true,
        origin: request.nextUrl.origin,
      });
      payload.embeds[0].description = 'Open the HearMeOut Discord Activity without queueing another video.';
      payload.embeds[0].author.name = 'Activity Invite';
      payload.components = [];
      const sent = await sendDiscordChannelMessage(channelId, payload);
      return NextResponse.json({ success: true, commandHandled: 'hearmeout-invite', sent, deletedCommand });
    }

    const fanoutPromise = fanoutDiscordChat(body, message);

    const watchCommand = parseWatchCommand(message) || parseWatchAcceptCommand(message);
    const isForwardedWatchCommand = /^!(wr|watch)(?:\s|$)/i.test(message) || /^!(add|accept)$/i.test(message.trim());
    if ((watchCommand || isForwardedWatchCommand) && channelId) {
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
        typeof reply === 'string' ? { content: reply, allowed_mentions: { parse: [] } } : normalizeHearMeOutReply(reply, request.nextUrl.origin)
      )));
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      return NextResponse.json({ success: true, skipped: 'watch-command-handled-by-voice-bot', fanout, discordSends, deletedCommand });
    }

    // Chat Tag: detect @spmt or spmt commands (Discord converts @spmt to <@botId>)
    const isSpmtCommand = msgLower.startsWith('spmt ') || msgLower.startsWith('@spmt ') || message.startsWith('<@1279582181768957963>');
    if (isSpmtCommand && channelId) {
      // Normalize the message to always start with @spmt
      let normalizedMsg = message;
      if (message.startsWith('<@')) {
        normalizedMsg = '@spmt ' + message.replace(/<@!?\d+>/g, '').trim();
      } else if (msgLower.startsWith('spmt ')) {
        normalizedMsg = '@spmt ' + message.substring(5);
      }
      const normalizedLower = normalizedMsg.toLowerCase().trim();
      if (normalizedLower === '@spmt embed' || normalizedLower === '@spmt panel') {
        try {
          const { postOrUpdateGameEmbed } = await import('@/lib/chat-tag-service');
          await postOrUpdateGameEmbed(guildId);
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
      console.log(`[DiscordChat] @spmt command detected from ${userName}: ${normalizedMsg} (channelId: ${channelId})`);
      handleSpmtCommand(normalizedMsg, userId, userName, guildId, channelId, messageId).catch(err =>
        console.error('[DiscordChat] @spmt handler error:', err)
      );
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
