import { NextRequest, NextResponse } from 'next/server';
import {
  deleteStreamWeaverReplySourceNow,
  processDueStreamWeaverReplyCleanups,
  recordStreamWeaverReplyCleanup,
} from '@/lib/streamweaver-reply-cleanup';
import { randomUUID } from 'node:crypto';
import { replaceDiscordUserMentions } from '@/lib/discord-mentions';
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
  getStreamweaverUrl,
} from '@/lib/runtime-config';
import { recordDiscordMessageActivity } from '@/lib/discord-activity-service';
import { parseDiscordChatPayload } from '@/lib/discord-chat-payload';
import { publishSpmtEvent } from '@/lib/spmt-client';
import { getChatTagServiceSecret } from '@/lib/runtime-secrets';
import { getStreamweaverCommandTimeoutMs } from '@/lib/streamweaver-command-timeout';
import { finalizePrivateDmDiscordMessage } from '@/lib/private-dm-finalizer';

const COOLDOWN_MS = 5 * 60 * 1000; // 1 point per 5 min per user
const discordChatCooldowns = new Map<string, number>();
const processedDiscordMessages = new Map<string, number>();
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
const PROCESS_STARTED_AT = Date.now();
const INITIAL_EVENT_GRACE_MS = 2 * 60 * 1000;
const CHAT_TAG_WEBHOOK_NAME = getChatTagWebhookName();
const CHAT_TAG_AVATAR_URL = getChatTagAvatarUrl();
const DISCORD_ACTIVITY_APPLICATION_ID = getDiscordActivityApplicationId();
const HMO_MOVIE_SESSION_ID = 'discord-watch-room';
const HMO_MUSIC_SESSION_ID = 'discord-music-room';

function logDiscordTrace(traceId: string, stage: string, details: Record<string, unknown> = {}) {
  console.log(`[DiscordTrace] ${JSON.stringify({
    traceId,
    service: 'discord-stream-hub',
    stage,
    ...details,
  })}`);
}

function publishDiscordBridgeEvent(type: string, input: {
  userId?: string;
  userName?: string;
  guildId?: string;
  channelId?: string;
  message?: string;
  summary: string;
  payload?: Record<string, unknown>;
}) {
  void publishSpmtEvent({
    type,
    visibility: 'community',
    actor: input.userId
      ? { userId: input.userId, username: input.userName || input.userId, displayName: input.userName || input.userId }
      : undefined,
    payload: {
      summary: input.summary,
      guildId: input.guildId || null,
      channelId: input.channelId || null,
      message: input.message || null,
      source: 'discord-stream-hub-discord-chat',
      ...(input.payload || {}),
    },
  });
}

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

let processedDiscordMessageWriteQueue: Promise<void> = Promise.resolve();

function compareDiscordMessageIds(left: string, right: string): number {
  try {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    if (leftId === rightId) return 0;
    return leftId > rightId ? 1 : -1;
  } catch {
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }
}

async function markDiscordMessageSeen(
  guildId: string,
  channelId: string,
  messageId: string,
  createdAt?: unknown,
): Promise<boolean> {
  if (!messageId || !channelId) return false;

  const now = Date.now();
  for (const [key, seenAt] of processedDiscordMessages) {
    if (now - seenAt > PROCESSED_MESSAGE_TTL_MS) {
      processedDiscordMessages.delete(key);
    }
  }

  const key = `${guildId}:${channelId}:${messageId}`;
  if (processedDiscordMessages.has(key)) return true;

  let alreadyHandled = false;
  processedDiscordMessageWriteQueue = processedDiscordMessageWriteQueue
    .catch(() => {})
    .then(async () => {
      const stateRef = db.collection('runtime').doc('discord-message-dedupe');
      const snapshot = await stateRef.get();
      const savedWatermarks = snapshot.exists && snapshot.data()?.watermarks
        && typeof snapshot.data().watermarks === 'object'
        ? snapshot.data().watermarks as Record<string, unknown>
        : {};
      const watermarks = Object.fromEntries(
        Object.entries(savedWatermarks)
          .map(([lane, value]) => [String(lane || '').trim(), String(value || '').trim()])
          .filter(([lane, value]) => lane && value)
          .slice(-2000),
      );
      const lane = `${guildId}:${channelId}`;
      const watermark = watermarks[lane];
      const createdAtMs = Date.parse(String(createdAt || ''));
      const staleEvent = Number.isFinite(createdAtMs)
        && createdAtMs < PROCESS_STARTED_AT - INITIAL_EVENT_GRACE_MS;

      if (staleEvent) {
        if (!watermark || compareDiscordMessageIds(messageId, watermark) > 0) {
          watermarks[lane] = messageId;
          await stateRef.set({
            version: 2,
            watermarks,
            updatedAt: new Date(now).toISOString(),
          });
        }
        alreadyHandled = true;
        return;
      }

      if (watermark && compareDiscordMessageIds(messageId, watermark) <= 0) {
        alreadyHandled = true;
        return;
      }

      watermarks[lane] = messageId;
      await stateRef.set({
        version: 2,
        watermarks,
        updatedAt: new Date(now).toISOString(),
      });
    });

  await processedDiscordMessageWriteQueue;
  processedDiscordMessages.set(key, now);
  return alreadyHandled;
}

async function sendDiscordChannelMessage(channelId: string, payload: any, privateDm = false) {
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

  const sent = await response.json();
  if (privateDm && Array.isArray(payload?.embeds) && payload.embeds.length && sent?.id) {
    await finalizePrivateDmDiscordMessage(channelId, sent.id);
  }
  return sent;
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

async function sendChatTagControlsButton(channelId: string, serverId: string, privateDm = false) {
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
    return sendDiscordChannelMessage(channelId, buildChatTagControlsButtonPayload(serverId), privateDm);
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

async function postStreamWeaverDiscordChat(
  body: any,
  traceId: string,
  replyMode: 'direct' | 'collect',
) {
  const sourceMessage = body?.message || body?.content || body?.root?.message || body?.root?.content;
  const timeoutMs = replyMode === 'collect'
    ? 45_000
    : getStreamweaverCommandTimeoutMs(sourceMessage);
  const response = await fetch(`${getStreamweaverUrl().replace(/\/$/, '')}/api/discord/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-chat-origin': replyMode === 'collect' ? 'dsh-fanout' : 'dsh-command-forward',
      'x-discord-trace-id': traceId,
      ...(replyMode === 'collect' ? { 'x-discord-reply-mode': 'collect' } : {}),
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`StreamWeaver Discord forward failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function forwardStreamWeaverDiscordCommand(body: any, traceId: string) {
  return postStreamWeaverDiscordChat(body, traceId, 'direct');
}

function normalizeCollectedReply(reply: any) {
  if (typeof reply === 'string') {
    return { content: reply, allowed_mentions: { parse: [] } };
  }
  return {
    content: typeof reply?.content === 'string' ? reply.content : '',
    ...(Array.isArray(reply?.embeds) ? { embeds: reply.embeds } : {}),
    ...(Array.isArray(reply?.components) ? { components: reply.components } : {}),
    allowed_mentions: reply?.allowed_mentions || { parse: [] },
  };
}

function summarizeStreamWeaverFanout(result: Awaited<ReturnType<typeof fanoutToStreamWeaver>> | null) {
  if (!result) return null;
  return {
    ok: result.ok,
    replyCount: result.replyCount,
    deliveredCount: result.deliveredCount,
    context: result.ok ? result.payload?.context || null : null,
    botResponded: result.ok ? Boolean(result.payload?.botResponded) : false,
    error: result.ok ? result.payload?.error || null : result.error,
  };
}

async function fanoutToStreamWeaver(body: any, channelId: string, traceId: string, privateDm = false) {
  const startedAt = Date.now();
  logDiscordTrace(traceId, 'fanout-start', {
    destination: 'streamweaver:/api/discord/chat',
    replyMode: 'collect',
  });
  try {
    const payload = await postStreamWeaverDiscordChat(body, traceId, 'collect');
    const replies = Array.isArray(payload?.replies) ? payload.replies : [];
    const sends = [];
    for (const reply of replies) {
      sends.push(await sendDiscordChannelMessage(channelId, normalizeCollectedReply(reply), privateDm));
    }
    const replyMessageIds = sends
      .map((sent: any) => String(sent?.id || '').trim())
      .filter(Boolean);
    if (replyMessageIds.length > 0) {
      await deleteStreamWeaverReplySourceNow(channelId, body?.messageId || body?.message_id).catch(() => false);
      await recordStreamWeaverReplyCleanup({
        channelId,
        sourceMessageId: body?.messageId || body?.message_id,
        replyMessageIds,
      }).catch((error) => {
        console.warn('[DiscordChat] StreamWeaver reply cleanup record failed:', error);
      });
    }
    logDiscordTrace(traceId, 'fanout-complete', {
      destination: 'streamweaver:/api/discord/chat',
      durationMs: Date.now() - startedAt,
      ok: true,
      botResponded: Boolean(payload?.botResponded),
      context: payload?.context || null,
      replyCount: replies.length,
      deliveredCount: sends.length,
      downstreamError: payload?.error || null,
    });
    return { ok: true, payload, replyCount: replies.length, deliveredCount: sends.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDiscordTrace(traceId, 'fanout-failed', {
      destination: 'streamweaver:/api/discord/chat',
      durationMs: Date.now() - startedAt,
      ok: false,
      error: message,
    });
    return { ok: false, error: message, replyCount: 0, deliveredCount: 0 };
  }
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

async function sendHearMeOutControls(channelId: string, origin?: string, privateDm = false) {
  const payload = buildHearMeOutControlsPayload({ origin });
  return sendDiscordChannelMessage(channelId, payload, privateDm);
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
  processDueStreamWeaverReplyCleanups().catch((error) => {
    console.warn('[DiscordChat] StreamWeaver reply cleanup sweep failed:', error);
  });
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
    const rawMessage = data.message || data.content || '';
    const message = replaceDiscordUserMentions(rawMessage, data);
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
    const embeds = Array.isArray(data.embeds) ? data.embeds : [];
    const mentions = data.mentions || [];
    const stickers = Array.isArray(data.sticker_items || data.stickers) ? (data.sticker_items || data.stickers) : [];
    const channelId = data.channelId || '';
    const messageId = data.messageId || '';
    const dispatch = data.dispatch !== false;
    const isDirectMessage = Boolean(data.isDM || data.isDirectMessage || data.is_direct_message);
    const isBotAuthor = Boolean(data.author?.bot || data.user?.bot || data.member?.user?.bot);
    const traceId = request.headers.get('x-discord-trace-id') || messageId || randomUUID();

    logDiscordTrace(traceId, 'ingress', {
      source: request.headers.get('x-chat-origin') || 'discord-bot',
      guildId: guildId || null,
      channelId: channelId || null,
      messageId: messageId || null,
      userId: userId || null,
      userName,
      isDirectMessage,
      isBotAuthor,
      dispatch,
      messageLength: message.length,
      messagePreview: isDirectMessage ? '[private message]' : message.slice(0, 120),
    });

    if (!userId || !guildId) {
      logDiscordTrace(traceId, 'rejected', { reason: 'missing-user-or-guild' });
      return NextResponse.json({ error: 'userId and guildId required' }, { status: 400 });
    }

    if ((!message || message.length === 0) && attachments.length === 0) {
      logDiscordTrace(traceId, 'skipped', { reason: 'empty-message' });
      return NextResponse.json({ success: true, skipped: 'empty message' });
    }

    if (await markDiscordMessageSeen(
      guildId,
      channelId,
      messageId,
      data.createdAt || data.created_at || data.timestamp,
    )) {
      console.log(`[DiscordChat] Duplicate message ignored: ${guildId}/${channelId}/${messageId}`);
      logDiscordTrace(traceId, 'skipped', { reason: 'duplicate-message' });
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
        const sent = await sendHearMeOutControls(channelId, request.nextUrl.origin, isDirectMessage);
        publishDiscordBridgeEvent('discord.hearmeout.controls_sent', {
          userId,
          userName,
          guildId,
          channelId,
          message,
          summary: `${userName} opened HearMeOut controls from Discord.`,
          payload: { delivery: 'channel', deletedCommand, sentMessageId: sent?.id || null },
        });
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
        const sent = await sendDiscordChannelMessage(channelId, payload, isDirectMessage);
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
      const deletedCommand = await deleteDiscordMessage(channelId, messageId);
      try {
        const activityVoiceChannelId = getActivityVoiceChannelId(data);
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
          activityVoiceChannelId,
          voiceChannelId: data.voiceChannelId || activityVoiceChannelId,
          voice_channel_id: data.voice_channel_id || activityVoiceChannelId,
          messageId,
          source: 'discord-stream-hub',
        });
        publishDiscordBridgeEvent('discord.hearmeout.command_forwarded', {
          userId,
          userName,
          guildId,
          channelId,
          message,
          summary: `${userName} forwarded a HearMeOut media command from Discord.`,
          payload: {
            command: message.trim().split(/\s+/)[0] || null,
            activityVoiceChannelId: activityVoiceChannelId || null,
            hearmeoutHandled: Boolean(result?.handled || result?.success),
            hearmeoutAction: result?.action || result?.commandHandled || null,
          },
        });
        return NextResponse.json({ success: true, commandHandled: 'watch-request', deletedCommand, hearmeout: result });
      } catch (error: any) {
        const sent = await sendDiscordChannelMessage(channelId, {
          content: `HearMeOut could not handle that watch request: ${error?.message || 'unknown error'}`,
          allowed_mentions: { parse: [] },
        });
        return NextResponse.json({ success: false, commandHandled: 'watch-request', deletedCommand, error: error?.message || 'HearMeOut request failed', sent }, { status: 502 });
      }
    }

    // DSH owns button-posting flows. Regular Chat Tag commands are handled directly by
    // the Chat Tag app, so we only keep the controls-button trigger here.
    const discordClientId = getDiscordClientId();
    const isSpmtMention = discordClientId ? rawMessage.startsWith(`<@${discordClientId}>`) || rawMessage.startsWith(`<@!${discordClientId}>`) : false;
    const isSpmtCommand = msgLower.startsWith('spmt ') || msgLower.startsWith('@spmt ') || isSpmtMention;
    if (isSpmtCommand && channelId) {
      let normalizedMsg = message;
      if (rawMessage.startsWith('<@')) {
        normalizedMsg = '@spmt ' + rawMessage.replace(/<@!?\d+>/g, '').trim();
      } else if (msgLower.startsWith('spmt ')) {
        normalizedMsg = '@spmt ' + message.substring(5);
      }
      const normalizedLower = normalizedMsg.toLowerCase().trim();
      if (normalizedLower === '@spmt controls' || normalizedLower === '@spmt control') {
        const sent = await sendChatTagControlsButton(channelId, guildId, isDirectMessage);
        const deletedCommand = await deleteDiscordMessage(channelId, messageId);
        console.log(`[DiscordChat] Sent Chat Tag controls button: ${sent?.id || 'unknown-message-id'}`);
        publishDiscordBridgeEvent('discord.chattag.controls_sent', {
          userId,
          userName,
          guildId,
          channelId,
          message,
          summary: `${userName} opened Chat Tag controls from Discord.`,
          payload: { deletedCommand, sentMessageId: sent?.id || null },
        });
        return NextResponse.json({ success: true, commandHandled: 'chat-tag-controls', messageId: sent?.id, deletedCommand });
      }
    }

    // DiscordStreamHub is the ingress owner for this bot. Forward remaining
    // bang commands from public channels and DMs once to StreamWeaver so its
    // command dispatcher can reply through the configured Discord bot/webhook
    // path. HearMeOut and Chat Tag commands return above and are not duplicated.
    if (dispatch && !isBotAuthor && channelId && message.trim().startsWith('!')) {
      try {
        logDiscordTrace(traceId, 'route-selected', {
          route: 'streamweaver-command',
          destination: 'streamweaver:/api/discord/chat',
        });
        const streamweaver = await forwardStreamWeaverDiscordCommand(body, traceId);
        console.log(`[DiscordChat] Forwarded StreamWeaver command from ${userName}: ${message}`);
        logDiscordTrace(traceId, 'route-complete', {
          route: 'streamweaver-command',
          ok: true,
          botResponded: Boolean(streamweaver?.botResponded),
          context: streamweaver?.context || null,
          downstreamError: streamweaver?.error || null,
        });
        return NextResponse.json({ success: true, commandHandled: 'streamweaver', streamweaver });
      } catch (error: any) {
        console.error('[DiscordChat] StreamWeaver command forward failed:', error);
        logDiscordTrace(traceId, 'route-failed', {
          route: 'streamweaver-command',
          error: error?.message || 'StreamWeaver command forward failed',
        });
        if (channelId) {
          await sendDiscordChannelMessage(channelId, {
            content: 'StreamWeaver could not handle that command right now. Please try again in a moment.',
            allowed_mentions: { parse: [] },
          }).catch(() => null);
        }
        return NextResponse.json({
          success: false,
          commandHandled: 'streamweaver',
          error: error?.message || 'StreamWeaver command forward failed',
        }, { status: 502 });
      }
    }

    let streamweaverFanout: Awaited<ReturnType<typeof fanoutToStreamWeaver>> | null = null;
    const shouldFanoutToStreamWeaver =
      dispatch
      && isDirectMessage
      && !isBotAuthor
      && !isSpmtCommand
      && Boolean(channelId)
      && !message.trim().startsWith('!');

    if (shouldFanoutToStreamWeaver) {
      streamweaverFanout = await fanoutToStreamWeaver(body, channelId, traceId, isDirectMessage);
    } else {
      logDiscordTrace(traceId, 'fanout-skipped', {
        destination: 'streamweaver:/api/discord/chat',
        reason: !dispatch
          ? 'dispatch-disabled'
          : !isDirectMessage
          ? 'public-owned-by-kite'
          : isBotAuthor
          ? 'bot-author-loop-protection'
          : isSpmtCommand
          ? 'chat-tag-owned'
          : !channelId
          ? 'missing-channel'
          : 'command-owned',
      });
    }
    const streamweaverFanoutSummary = summarizeStreamWeaverFanout(streamweaverFanout);

    // Check if user is in our community
    const userDoc = await db.collection('servers').doc(guildId).collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`[DiscordChat] ${userName} (${userId}) not in community DB, skipping points`);
      logDiscordTrace(traceId, 'complete', { reason: 'not-a-member', streamweaverFanout: streamweaverFanoutSummary });
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'not-a-member', streamweaverFanout });
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
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': getChatTagServiceSecret() },
          body: JSON.stringify({ action: 'chat-activity', userId: player.id, twitchUsername: twitchLogin, channel: 'discord' }),
        }).then((response) => {
          if (response.ok) {
            publishDiscordBridgeEvent('discord.chattag.activity_forwarded', {
              userId,
              userName,
              guildId,
              channelId,
              message,
              summary: `${userName} Discord activity was forwarded to Chat Tag.`,
              payload: { playerId: player.id, twitchLogin },
            });
          }
        }).catch(() => {});
      }
    }

    // Rate limit: 1 point per 5 min per user
    const now = Date.now();
    const lastAwarded = discordChatCooldowns.get(userId);
    if (lastAwarded && now - lastAwarded < COOLDOWN_MS) {
      logDiscordTrace(traceId, 'complete', { reason: 'points-cooldown', streamweaverFanout: streamweaverFanoutSummary });
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'cooldown', streamweaverFanout });
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
      logDiscordTrace(traceId, 'complete', { pointsAwarded: result.pointsAwarded, streamweaverFanout: streamweaverFanoutSummary });
      return NextResponse.json({ success: true, pointsAwarded: true, points: result.pointsAwarded, streamweaverFanout });
    } catch (pointsError) {
      console.error('[DiscordChat] awardPoints failed:', pointsError);
      logDiscordTrace(traceId, 'complete', { reason: 'award-error', streamweaverFanout: streamweaverFanoutSummary });
      return NextResponse.json({ success: true, pointsAwarded: false, reason: 'award-error', streamweaverFanout });
    }
  } catch (error) {
    console.error('[DiscordChat] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
