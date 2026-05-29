import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { awardPoints } from '@/lib/points-service';
// watch-request-service moved to hearmeout
const handleWatchRequestCommand = async (...args: any[]) => null;
const parseWatchAcceptCommand = (s: string) => null;
const parseWatchCommand = (s: string) => null;

const COOLDOWN_MS = 5 * 60 * 1000; // 1 point per 5 min per user
const discordChatCooldowns = new Map<string, number>();
const processedDiscordMessages = new Map<string, number>();
const CHAT_TAG_SERVICE_SECRET = process.env.CHAT_TAG_BOT_SECRET || process.env.BOT_SECRET_KEY || '1234';
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
const CHAT_TAG_WEBHOOK_NAME = process.env.CHAT_TAG_WEBHOOK_NAME || 'Chat Tag';
const CHAT_TAG_AVATAR_URL =
  process.env.CHAT_TAG_AVATAR_URL ||
  process.env.DISCORD_CHAT_TAG_AVATAR_URL ||
  '';
const DISCORD_ACTIVITY_APPLICATION_ID =
  process.env.DISCORD_ACTIVITY_APPLICATION_ID ||
  process.env.DISCORD_APP_ID ||
  process.env.DISCORD_CLIENT_ID ||
  process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

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

async function getOrCreateChatTagWebhook(channelId: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is not configured');

  const webhookDoc = await db.collection('webhooks').doc(channelId).get();
  const savedWebhook = webhookDoc.exists ? webhookDoc.data() : null;
  if (savedWebhook?.id && savedWebhook?.token) return savedWebhook;

  const webhooksResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
    headers: { Authorization: `Bot ${botToken}` },
    signal: timeoutSignal(7_000),
  });

  if (webhooksResponse.ok) {
    const webhooks = await webhooksResponse.json();
    const existing = Array.isArray(webhooks)
      ? webhooks.find((entry: any) => entry.name === CHAT_TAG_WEBHOOK_NAME)
      : null;
    if (existing?.id && existing?.token) {
      await db.collection('webhooks').doc(channelId).set({
        id: existing.id,
        token: existing.token,
        channelId,
        name: existing.name || CHAT_TAG_WEBHOOK_NAME,
      });
      return existing;
    }
  }

  const createResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CHAT_TAG_WEBHOOK_NAME, avatar: null }),
    signal: timeoutSignal(7_000),
  });

  if (!createResponse.ok) {
    throw new Error(`Failed to create Chat Tag webhook: ${createResponse.status} ${await createResponse.text()}`);
  }

  const webhook = await createResponse.json();
  await db.collection('webhooks').doc(channelId).set({
    id: webhook.id,
    token: webhook.token,
    channelId,
    name: webhook.name || CHAT_TAG_WEBHOOK_NAME,
  });
  return webhook;
}

function buildChatTagControlsButtonPayload(serverId: string) {
  return {
    content: '🏷️ Chat Tag controls',
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: 'Controls', custom_id: `chattag_controls_${serverId}` },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function sendChatTagControlsButton(channelId: string, serverId: string) {
  const payload: any = {
    ...buildChatTagControlsButtonPayload(serverId),
    username: CHAT_TAG_WEBHOOK_NAME,
  };
  if (CHAT_TAG_AVATAR_URL) payload.avatar_url = CHAT_TAG_AVATAR_URL;

  try {
    const webhook = await getOrCreateChatTagWebhook(channelId);
    const response = await fetch(
      `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}?wait=true&with_components=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: timeoutSignal(7_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Chat Tag webhook controls message failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  } catch (error) {
    console.error('[DiscordChat] Chat Tag webhook controls post failed, falling back to bot message:', error);
    return sendDiscordChannelMessage(channelId, buildChatTagControlsButtonPayload(serverId));
  }
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

function getPublicBaseUrl(origin?: string) {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || origin || '').replace(/\/$/, '');
}

function getSpaceMountainIconUrl(origin?: string) {
  const configured = process.env.SPACE_MOUNTAIN_ICON_URL || process.env.DISCORD_AUTHOR_ICON_URL;
  if (configured) return configured;

  const baseUrl = getPublicBaseUrl(origin);
  return baseUrl ? `${baseUrl}/cosmicraid.png` : undefined;
}

function isDiscordActivityInviteUrl(url: string) {
  return /^https:\/\/(discord\.gg|discord\.com\/invite)\//i.test(url);
}

function findDiscordActivityInviteUrl(payload: any) {
  for (const row of payload?.components || []) {
    for (const component of row?.components || []) {
      if (component?.type === 2 && component?.style === 5 && typeof component?.url === 'string') {
        const label = String(component.label || '').toLowerCase();
        if (label.includes('join') && isDiscordActivityInviteUrl(component.url)) {
          return component.url;
        }
      }
    }
  }

  for (const embed of payload?.embeds || []) {
    if (typeof embed?.url === 'string' && isDiscordActivityInviteUrl(embed.url)) {
      return embed.url;
    }
  }

  return undefined;
}

function getActivityVoiceChannelId(data: any) {
  return data.voiceChannelId
    || data.voice_channel_id
    || data.voiceChannel?.id
    || data.voice?.channelId
    || data.voice?.channel_id
    || data.member?.voice?.channel_id
    || process.env.DISCORD_ACTIVITY_VOICE_CHANNEL_ID;
}

async function createDiscordActivityInvite(voiceChannelId: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is not configured');
  if (!DISCORD_ACTIVITY_APPLICATION_ID) throw new Error('DISCORD_ACTIVITY_APPLICATION_ID is not configured');

  const response = await fetch(`https://discord.com/api/v10/channels/${voiceChannelId}/invites`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      max_age: 3600,
      max_uses: 0,
      target_type: 2,
      target_application_id: DISCORD_ACTIVITY_APPLICATION_ID,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Discord Activity invite failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  if (!payload?.code) throw new Error('Discord did not return an Activity invite code.');
  return `https://discord.gg/${payload.code}`;
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

function normalizeHearMeOutReply(reply: any, origin?: string, activityInviteUrl?: string) {
  if (!reply || typeof reply === 'string') return reply;

  const payload = { ...reply };
  const joinUrl = findDiscordActivityInviteUrl(payload) || activityInviteUrl;
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

function buildHearMeOutControlsPayload(options: { activityInviteUrl?: string; includeJoinPreview?: boolean; origin?: string } = {}) {
  const { activityInviteUrl, includeJoinPreview = false, origin } = options;
  const authorIcon = getSpaceMountainIconUrl(origin);

  return {
    content: '',
    embeds: [{
      title: 'HearMeOut',
      ...(activityInviteUrl && includeJoinPreview ? { url: activityInviteUrl } : {}),
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

async function createDiscordActivityInviteForPayload(data: any) {
  const voiceChannelId = getActivityVoiceChannelId(data);
  if (!voiceChannelId) return undefined;

  try {
    return await createDiscordActivityInvite(voiceChannelId);
  } catch (error) {
    console.warn('[DiscordChat] Could not create Discord Activity invite:', error);
    return undefined;
  }
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
      const voiceChannelId = getActivityVoiceChannelId(data);
      if (!voiceChannelId) {
        const sent = await sendDiscordChannelMessage(channelId, {
          content: 'Join a voice channel first, then run `!invite` again so I can create the Discord Activity invite.',
          allowed_mentions: { parse: [] },
        });
        return NextResponse.json({ success: true, commandHandled: 'hearmeout-invite', sent, deletedCommand, error: 'missing-voice-channel' });
      }

      try {
        const activityInviteUrl = await createDiscordActivityInvite(voiceChannelId);
        const payload = buildHearMeOutControlsPayload({
          activityInviteUrl,
          includeJoinPreview: true,
          origin: request.nextUrl.origin,
        });
        payload.embeds[0].description = 'Open the Discord Activity without queueing another video.';
        payload.embeds[0].author.name = 'Activity Invite';
        payload.components = [];
        const sent = await sendDiscordChannelMessage(channelId, payload);
        return NextResponse.json({ success: true, commandHandled: 'hearmeout-invite', sent, deletedCommand });
      } catch (error: any) {
        const sent = await sendDiscordChannelMessage(channelId, {
          content: `I could not create a Discord Activity invite: ${error?.message || 'unknown error'}`,
          allowed_mentions: { parse: [] },
        });
        return NextResponse.json({ success: true, commandHandled: 'hearmeout-invite', sent, deletedCommand, error: error?.message || 'invite-create-failed' });
      }
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
      const activityInviteUrl = await createDiscordActivityInviteForPayload(data);
      const discordSends = await Promise.all(replies.map((reply) => sendDiscordChannelMessage(
        channelId,
        typeof reply === 'string' ? { content: reply, allowed_mentions: { parse: [] } } : normalizeHearMeOutReply(reply, request.nextUrl.origin, activityInviteUrl)
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
      if (normalizedLower === '@spmt controls' || normalizedLower === '@spmt control') {
        const sent = await sendChatTagControlsButton(channelId, guildId);
        const deletedCommand = await deleteDiscordMessage(channelId, messageId);
        console.log(`[DiscordChat] Sent Chat Tag controls button: ${sent?.id || 'unknown-message-id'}`);
        const fanout = await fanoutPromise;
        return NextResponse.json({ success: true, commandHandled: 'chat-tag-controls', messageId: sent?.id, deletedCommand, fanout });
      }
      console.log(`[DiscordChat] Ignoring non-controls @spmt command; Chat Tag owns it: ${normalizedMsg}`);
      const fanout = await fanoutPromise;
      return NextResponse.json({ success: true, skipped: 'chat-tag-owned-command', fanout });
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
