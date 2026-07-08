import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { awardPoints } from '@/lib/points-service';
import {
  getAppUrl,
  getChatTagApiBase,
  getChatTagAvatarUrl,
  getChatTagWebhookName,
  getDiscordActivityApplicationId,
  getDiscordActivityVoiceChannelId,
  getDiscordClientId,
  getHardcodedGuildId,
  getHearMeOutUrl,
  getSpaceMountainIconUrl as getConfiguredSpaceMountainIconUrl,
} from '@/lib/runtime-config';
import { recordDiscordMessageActivity } from '@/lib/discord-activity-service';
import { parseDiscordChatPayload } from '@/lib/discord-chat-payload';

const COOLDOWN_MS = 5 * 60 * 1000; // 1 point per 5 min per user
const discordChatCooldowns = new Map<string, number>();
const processedDiscordMessages = new Map<string, number>();
const CHAT_TAG_SERVICE_SECRET = process.env.CHAT_TAG_BOT_SECRET || process.env.BOT_SECRET_KEY || '1234';
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
const CHAT_TAG_WEBHOOK_NAME = getChatTagWebhookName();
const CHAT_TAG_AVATAR_URL = getChatTagAvatarUrl();
const DISCORD_ACTIVITY_APPLICATION_ID = getDiscordActivityApplicationId();
const HMO_MOVIE_SESSION_ID = 'discord-watch-room';
const HMO_MUSIC_SESSION_ID = 'discord-music-room';

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
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
  return (getAppUrl() || origin || '').replace(/\/$/, '');
}

function getSpaceMountainIconUrl(origin?: string) {
  const configured = getConfiguredSpaceMountainIconUrl();
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
    || getDiscordActivityVoiceChannelId();
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

function getHearMeOutActivityUrl(sessionId = HMO_MOVIE_SESSION_ID) {
  const baseUrl = getHearMeOutUrl().replace(/\/$/, '');
  return `${baseUrl}/activity?sessionId=${encodeURIComponent(sessionId)}`;
}

function buildHearMeOutPromptControls(preferredSessionId = HMO_MOVIE_SESSION_ID, joinUrl?: string) {
  const preferred = preferredSessionId === HMO_MUSIC_SESSION_ID ? HMO_MUSIC_SESSION_ID : HMO_MOVIE_SESSION_ID;
  const other = preferred === HMO_MUSIC_SESSION_ID ? HMO_MOVIE_SESSION_ID : HMO_MUSIC_SESSION_ID;
  const preferredLabel = preferred === HMO_MUSIC_SESSION_ID ? 'Music Controls' : 'Movie Controls';
  const otherLabel = other === HMO_MUSIC_SESSION_ID ? 'Music Controls' : 'Movie Controls';
  return [{
    type: 1,
    components: [
      { type: 2, style: 1, label: preferredLabel, custom_id: `hmo_watch_controls:${preferred}`, emoji: { name: '🎛️' } },
      { type: 2, style: 2, label: otherLabel, custom_id: `hmo_watch_controls:${other}`, emoji: { name: '🎚️' } },
      { type: 2, style: 2, label: 'Choose Lane', custom_id: `hmo_watch_lane:${preferred}`, emoji: { name: '🔀' } },
      { type: 2, style: 2, label: 'Volume', custom_id: `hmo_watch_volume:${preferred}`, emoji: { name: '🔊' } },
      { type: 2, style: 5, label: 'Join Activity', url: joinUrl || getHearMeOutActivityUrl(preferred), emoji: { name: '🎬' } },
    ],
  }];
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
      footer: { text: 'Choose movie or music controls. Shared playback changes happen through Discord controls.' },
    }],
    components: buildHearMeOutPromptControls(HMO_MOVIE_SESSION_ID, activityInviteUrl),
    allowed_mentions: { parse: [] },
  };
}

async function sendHearMeOutControls(channelId: string, origin?: string) {
  const payload = buildHearMeOutControlsPayload({ origin });
  return sendDiscordChannelMessage(channelId, payload);
}

async function forwardHearMeOutDiscordChat(payload: any) {
  const hearMeOutUrl = getHearMeOutUrl().replace(/\/$/, '');
  const response = await fetch(`${hearMeOutUrl}/api/discord/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: timeoutSignal(20_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || `HearMeOut returned ${response.status}`);
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      const raw = await request.text();
      body = parseDiscordChatPayload(raw);
      if (!body) {
        return NextResponse.json({ success: true, skipped: 'invalid-json' });
      }
    } catch (error) {
      console.error('[DiscordChat] Invalid JSON payload:', error);
      return NextResponse.json({ success: true, skipped: 'invalid-json' });
    }
    console.log('[DiscordChat] Received:', JSON.stringify(body).slice(0, 200));

    // Support Kite format (may nest under 'root'), direct format, and old format
    const data = body.root || body;
    const userId = data.userId;
    const guildId = data.guildId || data.serverId || getHardcodedGuildId();
    const userName = data.userName || data.displayName || data.username || 'Unknown';
    const userAvatar = data.userAvatar || data.avatarUrl || '';
    const message = data.message || data.content || '';
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
    const embeds = Array.isArray(data.embeds) ? data.embeds : [];
    const mentions = Array.isArray(data.mentions) ? data.mentions : [];
    const stickers = Array.isArray(data.sticker_items || data.stickers) ? (data.sticker_items || data.stickers) : [];
    const channelId = data.channelId || '';
    const messageId = data.messageId || '';
    const dispatch = data.dispatch !== false;
    const isDirectMessage = Boolean(data.isDM || data.isDirectMessage || data.is_direct_message);
    const isBotAuthor = Boolean(data.author?.bot || data.user?.bot || data.member?.user?.bot);

    if (!userId || !guildId) {
      return NextResponse.json({ error: 'userId and guildId required' }, { status: 400 });
    }

    if ((!message || message.length === 0) && attachments.length === 0) {
      return NextResponse.json({ success: true, skipped: 'empty message' });
    }

    if (markDiscordMessageSeen(guildId, channelId, messageId)) {
      console.log(`[DiscordChat] Duplicate message ignored: ${guildId}/${channelId}/${messageId}`);
      return NextResponse.json({ success: true, skipped: 'duplicate-message', messageId });
    }

    const msgLower = message.toLowerCase();

    if (dispatch && !isDirectMessage && channelId && guildId && messageId && !isBotAuthor) {
      const appOrigin = getPublicBaseUrl(request.nextUrl.origin);
      void fetch(`${appOrigin}/api/discord/forward-to-forum`, {
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
          attachments,
          embeds,
          mentions,
          stickers,
        }),
        signal: timeoutSignal(8000),
      }).catch((error) => {
        console.warn('[DiscordChat] Forum forward request failed:', error?.message || error);
      });
    }

    if (/^!(controls?|watch-controls)$/i.test(message.trim()) && channelId) {
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      try {
        const sent = await sendHearMeOutControls(channelId, request.nextUrl.origin);
        return NextResponse.json({ success: true, commandHandled: 'hearmeout-controls', delivery: 'channel', deletedCommand, sent });
      } catch (error: any) {
        return NextResponse.json({
          success: false,
          commandHandled: 'hearmeout-controls',
          delivery: 'channel',
          deletedCommand,
          error: error?.message || 'Failed to send controls',
        }, { status: 502 });
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

    const isForwardedWatchCommand = /^!(wr|watch|sr|song)(?:\s|$)/i.test(message) || /^!(add|accept)$/i.test(message.trim());
    if (isForwardedWatchCommand && channelId) {
      console.log(`[DiscordChat] Forwarding watch request to HearMeOut from ${userName}: ${message} (channelId: ${channelId})`);
      try {
        const result = await forwardHearMeOutDiscordChat({
          ...data,
          message,
          content: message,
          userId,
          userName,
          displayName: userName,
          guildId,
          serverId: guildId,
          channelId,
          messageId,
          source: 'discord-stream-hub',
        });
        return NextResponse.json({ success: true, commandHandled: 'watch-request', hearmeout: result });
      } catch (error: any) {
        const sent = await sendDiscordChannelMessage(channelId, {
          content: `HearMeOut could not handle that watch request: ${error?.message || 'unknown error'}`,
          allowed_mentions: { parse: [] },
        });
        return NextResponse.json({ success: false, commandHandled: 'watch-request', error: error?.message || 'HearMeOut request failed', sent }, { status: 502 });
      }
    }

    // DSH owns button-posting flows. Regular Chat Tag commands are handled directly by
    // the Chat Tag app, so we only keep the controls-button trigger here.
    const discordClientId = getDiscordClientId();
    const isSpmtMention = discordClientId ? message.startsWith(`<@${discordClientId}>`) || message.startsWith(`<@!${discordClientId}>`) : false;
    const isSpmtCommand = msgLower.startsWith('spmt ') || msgLower.startsWith('@spmt ') || isSpmtMention;
    if (isSpmtCommand && channelId) {
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
        return NextResponse.json({ success: true, commandHandled: 'chat-tag-controls', messageId: sent?.id, deletedCommand });
      }
    }

    // Check if user is in our community
    const userDoc = await db.collection('servers').doc(guildId).collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`[DiscordChat] ${userName} (${userId}) not in community DB, skipping points`);
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'not-a-member' });
    }

    await recordDiscordMessageActivity({
      serverId: guildId,
      userId,
      username: userName,
      displayName: userName,
      avatarUrl: userAvatar,
      channelId,
      channelName: data.channelName || data.channel?.name || '',
    }).catch((error) => {
      console.warn('[DiscordChat] Failed to record Discord activity metrics:', error);
    });

    // Track Discord chat activity in chat-tag (auto-wake, lastSeenChannel)
    const twitchLogin = userDoc.data()?.twitchLogin;
    if (twitchLogin) {
      const tagData = await (async () => {
        try {
          const r = await fetch(`${getChatTagApiBase()}/api/tag`);
          return r.ok ? await r.json() : null;
        } catch { return null; }
      })();
      const player = tagData?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin.toLowerCase());
      if (player) {
        fetch(`${getChatTagApiBase()}/api/tag`, {
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
