import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { db } from '@/lib/db';
import { submitCaptainLog, submitMission } from '@/lib/calendar-admin-actions';
import { shiftCalendarMonth } from '@/lib/calendar-discord-service-new';
import { format } from 'date-fns';
import {
  getChatTagApiBase,
  getDiscordClientId,
  getHardcodedGuildId,
  getDiscordPublicKey,
  getHearMeOutUrl as getHearMeOutUrlFromRuntime,
  getStreamweaverUrl,
} from '@/lib/runtime-config';
import { grandfatherDiscordIdentity } from '@/lib/spmt-client';
import { getChatTagServiceSecret, getDshClientSecret } from '@/lib/runtime-secrets';
import {
  createSpmtOnboardingAuthorization,
} from '@/lib/spmt-onboarding-service';
import { SPMT_ONBOARDING_CUSTOM_ID } from '@/lib/spmt-onboarding-contract';
import {
  APPLICATION_DEFINITIONS,
  APPLICATION_FLOW_VERSION,
  ApplicationType,
  buildApplicationModal,
  buildInquiryMessage,
  parseApplicationType,
} from '@/lib/application-flow';

function extractValues(components: any[] = []) {
  const values: Record<string, string> = {};
  components.forEach(row => {
    row.components?.forEach((component: any) => {
      values[component.custom_id] = component.value;
    });
  });
  return values;
}

function ephemeral(content: string, extra: any = {}) {
  return NextResponse.json({
    type: 4,
    data: { content, flags: 64, ...extra },
  });
}

function discordAvatarUrl(user: any) {
  if (!user?.id || !user?.avatar) return '';
  const extension = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=256`;
}

async function sendApplicationInquiry(body: any, type: ApplicationType, serverId: string) {
  const applicationId = body.application_id || getDiscordClientId();
  await fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 5, data: { content: 'Preparing your private SPMT information packet…', flags: 64 } }),
  });

  const botToken = process.env.DISCORD_BOT_TOKEN || '';
  const actor = body.member?.user || body.user || {};
  try {
    if (!botToken || !actor.id) throw new Error('Discord DM delivery is unavailable.');
    const [serverDoc, brandingDoc] = await Promise.all([
      db.collection('servers').doc(serverId).get(),
      db.collection('servers').doc(serverId).collection('config').doc('branding').get(),
    ]);
    const serverName = brandingDoc.data()?.serverName || serverDoc.data()?.serverName || 'SPMT';
    const dmResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: actor.id }),
    });
    if (!dmResponse.ok) throw new Error('Open your Discord DMs and try again.');
    const dm = await dmResponse.json();
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInquiryMessage(type, serverId, serverName)),
    });
    if (!messageResponse.ok) throw new Error('Discord refused the information DM.');
    await db.collection('servers').doc(serverId).collection('applicationInquiries').add({
      type,
      userId: actor.id,
      username: actor.username || actor.id,
      sentAt: new Date().toISOString(),
      flowVersion: APPLICATION_FLOW_VERSION,
      status: 'informed',
    });
    await updateDeferredInteraction(applicationId, body.token, '✅ Check your DMs for the SPMT information packet and application button.');
  } catch (error) {
    await updateDeferredInteraction(applicationId, body.token, `⚠️ ${error instanceof Error ? error.message : 'Unable to send the inquiry DM.'}`);
  }
}

const CHAT_TAG_SERVICE_SECRET = getChatTagServiceSecret();
const HMO_MOVIE_SESSION_ID = 'discord-watch-room';
const HMO_MUSIC_SESSION_ID = 'discord-music-room';
const HMO_WATCH_SESSION_ID = HMO_MOVIE_SESSION_ID;

function buildChatTagControlRows(serverId: string) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Join Game', custom_id: `chattag_join_${serverId}` },
        { type: 2, style: 1, label: 'Status', custom_id: `chattag_status_${serverId}` },
        { type: 2, style: 1, label: 'My Score', custom_id: `chattag_score_${serverId}` },
        { type: 2, style: 4, label: 'Away', custom_id: `chattag_togglesleep_${serverId}` },
        { type: 2, style: 2, label: 'Admin', custom_id: `chattag_admin_${serverId}` },
      ],
    },
  ];
}

async function deleteDiscordMessage(channelId?: string, messageId?: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken || !channelId || !messageId) return;

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${botToken}` },
  }).catch((error) => {
    console.error('[DiscordInteractions] Failed to delete Chat Tag controls button:', error);
    return null;
  });

  if (response && !response.ok && response.status !== 404) {
    console.error(`[DiscordInteractions] Failed to delete Chat Tag controls button: ${response.status} ${await response.text().catch(() => '')}`);
  }
}

async function refreshChatTagEmbed(reason: string) {
  if (!CHAT_TAG_SERVICE_SECRET) throw new Error('Chat Tag service secret is not configured.');
  const response = await fetch(`${getChatTagApiBase()}/api/discord/announce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': CHAT_TAG_SERVICE_SECRET },
    body: JSON.stringify({ refreshOnly: true, message: reason }),
  });

  if (!response.ok) {
    throw new Error(`Chat Tag refresh failed: ${response.status} ${await response.text().catch(() => '')}`);
  }
}

function getHearMeOutUrl() {
  return getHearMeOutUrlFromRuntime().replace(/\/$/, '');
}

function discordMemberCanManageWatch(member: any) {
  const permissions = BigInt(String(member?.permissions || '0') || '0');
  const ADMINISTRATOR = BigInt(0x8);
  const MANAGE_MESSAGES = BigInt(0x2000);
  const MANAGE_GUILD = BigInt(0x20);
  return Boolean(permissions & ADMINISTRATOR || permissions & MANAGE_MESSAGES || permissions & MANAGE_GUILD);
}

function parseHearMeOutControlId(customId: string) {
  const [, action = '', ...sessionParts] = customId.split(':');
  return {
    action,
    sessionId: normalizeHearMeOutSessionId(sessionParts.join(':')),
  };
}

function normalizeHearMeOutSessionId(sessionId?: string) {
  const raw = String(sessionId || '').trim().toLowerCase();
  if (raw === HMO_MUSIC_SESSION_ID || raw === 'music' || raw === 'song') return HMO_MUSIC_SESSION_ID;
  if (raw === HMO_MOVIE_SESSION_ID || raw === 'movie' || raw === 'watch') return HMO_MOVIE_SESSION_ID;
  return raw.startsWith('watch-') ? raw : HMO_MOVIE_SESSION_ID;
}

function getHearMeOutActivityUrl(sessionId = HMO_MOVIE_SESSION_ID) {
  return `${getHearMeOutUrl()}/activity?sessionId=${encodeURIComponent(normalizeHearMeOutSessionId(sessionId))}`;
}

function buildHearMeOutControls(sessionId = HMO_WATCH_SESSION_ID) {
  const resolvedSessionId = normalizeHearMeOutSessionId(sessionId);
  const id = (action: string) => `hmo_watch_control:${action}:${resolvedSessionId}`;
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Play/Pause', custom_id: id('play-pause'), emoji: { name: '⏯️' } },
        { type: 2, style: 1, label: 'Next', custom_id: id('next'), emoji: { name: '⏭️' } },
        { type: 2, style: 4, label: 'Clear', custom_id: id('clear'), emoji: { name: '🧹' } },
        { type: 2, style: 2, label: 'Volume', custom_id: `hmo_watch_volume:${resolvedSessionId}`, emoji: { name: '🔊' } },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: 'Open Activity', url: getHearMeOutActivityUrl(resolvedSessionId), emoji: { name: '🎬' } },
      ],
    },
  ];
}

function buildHearMeOutLaneControls() {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Movie Controls', custom_id: `hmo_watch_controls:${HMO_MOVIE_SESSION_ID}`, emoji: { name: '🎛️' } },
        { type: 2, style: 1, label: 'Music Controls', custom_id: `hmo_watch_controls:${HMO_MUSIC_SESSION_ID}`, emoji: { name: '🎚️' } },
      ],
    },
  ];
}

function buildHearMeOutVolumeControls(sessionId = HMO_WATCH_SESSION_ID) {
  const resolvedSessionId = normalizeHearMeOutSessionId(sessionId);
  return [{
    type: 1,
    components: [
      { type: 2, style: 2, label: 'Mute', custom_id: `hmo_watch_control:mute:${resolvedSessionId}`, emoji: { name: '🔇' } },
      { type: 2, style: 2, label: 'Unmute', custom_id: `hmo_watch_control:unmute:${resolvedSessionId}`, emoji: { name: '🔊' } },
      { type: 2, style: 1, label: 'Set Volume', custom_id: `hmo_watch_volume_modal:${resolvedSessionId}`, emoji: { name: '🎚️' } },
    ],
  }];
}

function buildHearMeOutVolumeModal(sessionId = HMO_WATCH_SESSION_ID) {
  const resolvedSessionId = normalizeHearMeOutSessionId(sessionId);
  return {
    custom_id: `hmo_watch_volume_submit:${resolvedSessionId}`,
    title: 'Set HearMeOut Volume',
    components: [{
      type: 1,
      components: [{
        type: 4,
        custom_id: 'volume_value',
        label: 'Volume 0-100',
        style: 1,
        required: true,
        min_length: 1,
        max_length: 3,
        placeholder: '85',
      }],
    }],
  };
}

function readModalValue(data: any, customId: string) {
  for (const row of data?.components || []) {
    for (const component of row.components || []) {
      if (component.custom_id === customId) return component.value;
    }
  }
  return '';
}

async function fetchHearMeOutWatchSession(signal: AbortSignal, sessionId = HMO_WATCH_SESSION_ID) {
  const url = `${getHearMeOutUrl()}/api/watch/sessions/${encodeURIComponent(normalizeHearMeOutSessionId(sessionId))}/state`;
  const response = await fetch(url, { signal, cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return null;
  return payload?.session || payload;
}

async function resolveHearMeOutToggleAction(action: string, signal: AbortSignal, sessionId = HMO_WATCH_SESSION_ID) {
  if (action !== 'play-pause' && action !== 'mute-unmute') return action;

  const session = await fetchHearMeOutWatchSession(signal, sessionId).catch(() => null);
  if (action === 'play-pause') {
    return session?.playback?.status === 'playing' ? 'pause' : 'play';
  }

  return session?.playback?.muted === true ? 'unmute' : 'mute';
}

async function runHearMeOutWatchControl(action: string, sessionId = HMO_WATCH_SESSION_ID, actor?: {
  userId?: string;
  guildId?: string;
  channelId?: string;
  isAdmin?: boolean;
}, position?: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const resolvedAction = await resolveHearMeOutToggleAction(action, controller.signal, sessionId);
    const params = new URLSearchParams({
      action: resolvedAction,
      format: 'json',
      platform: 'discord',
    });
    if (actor?.userId) params.set('actorUserId', actor.userId);
    if (actor?.guildId) params.set('guildId', actor.guildId);
    if (actor?.channelId) params.set('channelId', actor.channelId);
    if (position !== undefined) params.set('position', String(position));
    params.set('isAdmin', actor?.isAdmin === true ? 'true' : 'false');
    const url = `${getHearMeOutUrl()}/api/watch/sessions/${encodeURIComponent(normalizeHearMeOutSessionId(sessionId))}/quick-control?${params.toString()}`;
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, message: payload?.error || `HearMeOut returned ${response.status}` };
    }

    const title = payload?.session?.current?.item?.title || 'watch room';
    const status = payload?.session?.playback?.status || 'updated';
    const muted = payload?.session?.playback?.muted;
    const volume = payload?.session?.playback?.volume;
    const label = resolvedAction === 'next' ? 'Skipped' : resolvedAction === 'clear' ? 'Cleared' : resolvedAction === 'volume' ? 'Volume set' : resolvedAction[0].toUpperCase() + resolvedAction.slice(1);
    const audio = typeof muted === 'boolean' ? (muted ? ', muted' : ', unmuted') : '';
    const volumeText = typeof volume === 'number' ? `, volume ${volume}%` : '';
    return { ok: true, message: `${label}: **${title}** (${status}${audio}${volumeText})` };
  } catch (error: any) {
    return { ok: false, message: error?.name === 'AbortError' ? 'HearMeOut timed out.' : 'HearMeOut control request failed.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function updateDeferredInteraction(applicationId: string, token: string, content: string) {
  if (!applicationId || !token) return;
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch((error) => {
    console.error('[DiscordInteractions] Failed to update HearMeOut control response:', error);
  });
}

async function updateDeferredInteractionPayload(applicationId: string, token: string, payload: any) {
  if (!applicationId || !token) return;
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.error('[DiscordInteractions] Failed to update StreamWeaver Pokémon response:', error);
  });
}

async function forwardStreamWeaverPokemonTrade(body: any, customId: string) {
  const match = customId.match(/^sw_pokemon_trade_(accept|decline):(.+)$/);
  if (!match) throw new Error('Invalid Pokémon trade control.');
  const secret = getDshClientSecret();
  if (!secret) throw new Error('DiscordStreamHub service secret is not configured.');
  const response = await fetch(`${getStreamweaverUrl().replace(/\/$/, '')}/api/discord/pokemon-interaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      action: match[1],
      tradeId: match[2],
      actorDiscordId: body.member?.user?.id || body.user?.id,
      actorName: body.member?.user?.global_name || body.member?.user?.username || body.user?.global_name || body.user?.username,
      guildId: body.guild_id,
      channelId: body.channel_id,
      messageId: body.message?.id,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `StreamWeaver returned ${response.status}.`);
  return payload?.data || payload;
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const rawBody = await request.text();

    const publicKey = getDiscordPublicKey();
    if (!publicKey || !signature || !timestamp) {
      console.error('[DiscordInteractions] Invalid request metadata', {
        hasPublicKey: Boolean(publicKey),
        hasSignature: Boolean(signature),
        hasTimestamp: Boolean(timestamp),
      });
      return NextResponse.json({ error: 'Invalid request' }, { status: 401 });
    }

    const isValid = verifyKey(rawBody, signature, timestamp, publicKey);
    if (!isValid) {
      console.error('[DiscordInteractions] Signature verification failed', {
        bodyLength: rawBody.length,
        timestamp,
      });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    if (body.type === 1) {
      return NextResponse.json({ type: 1 });
    }

    const customId: string | undefined = body.data?.custom_id;
    if ((body.type === 3 || body.type === 5) && customId) {
      const interactionKind = body.type === 3 ? 'button' : 'modal';
      const actorId = body.member?.user?.id || body.user?.id || 'unknown';
      console.log(`[DiscordInteraction] ${interactionKind} action=${customId} guild=${body.guild_id || 'dm'} user=${actorId}`);
    }

    if (body.type === 3 && customId) {
      if (customId.startsWith('sw_pokemon_trade_')) {
        const applicationId = body.application_id || getDiscordClientId();
        forwardStreamWeaverPokemonTrade(body, customId)
          .then((payload) => updateDeferredInteractionPayload(applicationId, body.token, payload))
          .catch((error) => {
            const actor = body.member?.user || body.user || {};
            const actorName = actor.global_name || actor.username || 'Discord User';
            const actorAvatar = actor.id && actor.avatar
              ? `https://cdn.discordapp.com/avatars/${actor.id}/${actor.avatar}.${String(actor.avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`
              : `${getStreamweaverUrl().replace(/\/$/, '')}/StreamWeaver.png`;
            return updateDeferredInteractionPayload(applicationId, body.token, {
              content: '',
              embeds: [{
                author: {
                  name: 'StreamWeaver',
                  icon_url: `${getStreamweaverUrl().replace(/\/$/, '')}/StreamWeaver.png`,
                  url: getStreamweaverUrl(),
                },
                title: 'Pokémon Card Trade • Error',
                description: `❌ ${error?.message || 'The Pokémon trade action failed.'}`,
                thumbnail: { url: actorAvatar },
                footer: {
                  text: `Requested by ${actorName} • Trade control`,
                  icon_url: actorAvatar,
                },
                color: 0x5865f2,
                timestamp: new Date().toISOString(),
              }],
              components: body.message?.components || [],
              allowed_mentions: { parse: [] },
            });
          });
        return NextResponse.json({ type: 6 });
      }

      if (
        customId === SPMT_ONBOARDING_CUSTOM_ID ||
        customId === 'spmt_onboard' ||
        customId === 'link_twitch_account' ||
        customId.startsWith('link_twitch_')
      ) {
        const legacyServerId = customId.startsWith('link_twitch_') && customId !== 'link_twitch_account'
          ? customId.replace('link_twitch_', '')
          : '';
        // The signed interaction's guild is authoritative. The legacy custom-ID
        // suffix is retained only for old messages whose payload omitted guild_id.
        const serverId = String(body.guild_id || legacyServerId).trim();
        const actor = body.member?.user || body.user || {};
        const userId = String(actor.id || '').trim();
        if (!serverId || !userId) return ephemeral('⚠️ Discord could not identify you or this server. Please try again.');
        const authorizeUrl = await createSpmtOnboardingAuthorization({
          serverId,
          discordUserId: userId,
          discordUsername: String(actor.username || userId),
          discordDisplayName: String(body.member?.nick || actor.global_name || actor.username || userId),
          discordAvatarUrl: discordAvatarUrl(actor),
          roles: Array.isArray(body.member?.roles) ? body.member.roles.map(String) : [],
        });
        return ephemeral('🚀 **One crew. One identity.**\n\nContinue with Twitch to create, claim, or recover your SPMT identity and join automatic shoutouts.', {
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 5,
              label: 'Continue with Twitch',
              url: authorizeUrl,
              emoji: { name: '🟣' },
            }],
          }],
          allowed_mentions: { parse: [] },
        });
      }

      if (customId.startsWith('hmo_watch_controls:')) {
        const sessionId = normalizeHearMeOutSessionId(customId.split(':').slice(1).join(':'));
        return ephemeral('HearMeOut controls', {
          components: buildHearMeOutControls(sessionId),
          allowed_mentions: { parse: [] },
        });
      }

      if (customId.startsWith('hmo_watch_lane:')) {
        return ephemeral('Choose which HearMeOut lane to control.', {
          components: buildHearMeOutLaneControls(),
          allowed_mentions: { parse: [] },
        });
      }

      if (customId.startsWith('hmo_watch_volume_modal:')) {
        const sessionId = normalizeHearMeOutSessionId(customId.split(':').slice(1).join(':'));
        return NextResponse.json({
          type: 9,
          data: buildHearMeOutVolumeModal(sessionId),
        });
      }

      if (customId.startsWith('hmo_watch_volume:')) {
        const sessionId = normalizeHearMeOutSessionId(customId.split(':').slice(1).join(':'));
        return ephemeral('Volume controls update the shared HearMeOut session.', {
          components: buildHearMeOutVolumeControls(sessionId),
          allowed_mentions: { parse: [] },
        });
      }

      if (customId.startsWith('hmo_watch_control:')) {
        const { action, sessionId } = parseHearMeOutControlId(customId);
        const applicationId = body.application_id || getDiscordClientId();
        runHearMeOutWatchControl(action, sessionId, {
          userId: body.member?.user?.id || body.user?.id,
          guildId: body.guild_id,
          channelId: body.channel_id,
          isAdmin: discordMemberCanManageWatch(body.member),
        })
          .then((result) => updateDeferredInteraction(applicationId, body.token, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`))
          .catch((error) => updateDeferredInteraction(applicationId, body.token, `❌ ${error?.message || 'HearMeOut control request failed.'}`));

        return NextResponse.json({
          type: 5,
          data: { content: 'Sending control to HearMeOut...', flags: 64 },
        });
      }

      // Chat Tag button interactions
      if (customId.startsWith('chattag_')) {
        const serverId = body.guild_id || getHardcodedGuildId();
        const clickerId = body.member?.user?.id || body.user?.id;
        const clickerName = body.member?.user?.username || body.user?.username || 'Unknown';

        if (customId.startsWith('chattag_controls_')) {
          deleteDiscordMessage(body.channel_id || body.message?.channel_id, body.message?.id).catch((error) => {
            console.error('[DiscordInteractions] Chat Tag controls cleanup failed:', error);
          });
          return ephemeral('🏷️ **Chat Tag Controls**', {
            components: buildChatTagControlRows(serverId),
            allowed_mentions: { parse: [] },
          });
        }

        if (customId.startsWith('chattag_score_')) {
          const { fetchTagData, buildScoreEmbed } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          const data = await fetchTagData();
          const players = data?.players || [];
          const player = twitchLogin
            ? players.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin)
            : null;
          const sorted = [...players].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
          const rank = player ? sorted.findIndex((p: any) => p.id === player.id) + 1 : 0;
          return ephemeral(buildScoreEmbed(player, rank, sorted.length));
        }

        if (customId.startsWith('chattag_join_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          const joinName = twitchLogin || clickerName.toLowerCase();
          const data = await fetchTagData();
          const existing = data?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === joinName);
          if (existing) return ephemeral(`✅ You're already in the game as ${joinName}!`);
          const { default: postTagApi } = await import('@/lib/chat-tag-service').then(m => ({ default: (e: string, b: any) => fetch(`${getChatTagApiBase()}${e}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-secret': CHAT_TAG_SERVICE_SECRET }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => null) }));
          const res = await postTagApi('/api/tag', { action: 'join', userId: `discord_${clickerId}`, twitchUsername: joinName, avatar: '' });
          return ephemeral(res?.error ? `❌ ${res.error}` : `🎯 You joined the tag game as ${joinName}!`);
        }

        if (customId.startsWith('chattag_status_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const data = await fetchTagData();
          const itPlayer = data?.players?.find((p: any) => p.isIt);
          const itName = itPlayer ? (itPlayer.twitchUsername || 'Someone') : null;
          return ephemeral(itName ? `🎯 **${itName}** is it!` : `🔥 **FREE FOR ALL!** Anyone can tag for DOUBLE POINTS!`);
        }

        if (customId.startsWith('chattag_leaderboard_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const data = await fetchTagData();
          const players = [...(data?.players || [])]
            .filter((p: any) => (p.twitchUsername || p.username))
            .sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
          const lines = players.slice(0, 25).map((p: any, index: number) => {
            const name = p.twitchUsername || p.username || p.id || 'Unknown';
            return `**#${index + 1}** ${name} — ${p.score || 0} pts (${p.tags || 0} tags, ${p.tagged || 0} tagged)`;
          });
          return ephemeral(lines.length ? `🏆 **Full Chat Tag Leaderboard**\n${lines.join('\n')}` : 'No leaderboard data yet.');
        }

        if (customId.startsWith('chattag_togglesleep_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          if (!twitchLogin) return ephemeral('❌ Link your Twitch account first.');
          const data = await fetchTagData();
          const player = data?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin);
          if (!player) return ephemeral('❌ You\'re not in the tag game. Use the Join button first.');
          const isSleeping = player.sleepingImmunity || player.offlineImmunity;
          const action = isSleeping ? 'wake' : 'sleep';
          await fetch(`${getChatTagApiBase()}/api/tag`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-secret': CHAT_TAG_SERVICE_SECRET },
            body: JSON.stringify({ action, userId: player.id }),
          });
          return ephemeral(isSleeping ? `☀️ You're awake! You can be tagged again.` : `😴 You're now sleeping (immune from tags).`);
        }

        if (customId.startsWith('chattag_bingo_')) {
          const { fetchGameState, buildBingoComponents, buildBingoPhrasesList } = await import('@/lib/chat-tag-service');
          const gs = await fetchGameState();
          const bingoPayload = buildBingoComponents(gs?.bingo, serverId);
          // Add phrases as content prefix (truncated to fit)
          const phrases = buildBingoPhrasesList(gs?.bingo);
          const phrasesPreview = phrases.length > 1500 ? phrases.slice(0, 1500) + '...' : phrases;
          return NextResponse.json({
            type: 4,
            data: { content: `${bingoPayload.content}\n\n${phrasesPreview}`, components: bingoPayload.components, flags: 64 },
          });
        }

        if (customId.startsWith('chattag_claim_')) {
          const parts = customId.split('_');
          const squareIndex = parseInt(parts[parts.length - 1]);
          if (isNaN(squareIndex)) return ephemeral('❌ Invalid square.');
          const { claimBingoSquare, fetchGameState, buildBingoComponents } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          const claimUserId = twitchLogin || `discord_${clickerId}`;
          const res = await claimBingoSquare(squareIndex, claimUserId, twitchLogin || clickerName);
          if (res?.error) return ephemeral(`❌ ${res.error}`);
          const gs = await fetchGameState();
          const updated = buildBingoComponents(gs?.bingo, serverId);
          const bingoMsg = res?.bingo ? '🎉 **BINGO!** +100 points!' : `✅ Claimed square ${squareIndex}!`;
          return NextResponse.json({
            type: 7,
            data: { content: `${bingoMsg}\n\n${updated.content}`, components: updated.components, flags: 64 },
          });
        }

        if (customId.startsWith('chattag_admin_')) {
          const { fetchGameState, buildAdminEmbed } = await import('@/lib/chat-tag-service');
          const gs = await fetchGameState();
          const adminPayload = buildAdminEmbed(gs, serverId);
          return NextResponse.json({ type: 4, data: adminPayload });
        }

        if (customId.startsWith('chattag_makemeit_')) {
          const { setMeAsIt, fetchTagData } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          if (!twitchLogin) return ephemeral('❌ Link your Twitch account first.');
          const data = await fetchTagData();
          const player = data?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin);
          if (!player) return ephemeral('❌ You\'re not in the tag game.');
          await setMeAsIt(player.id);
          await refreshChatTagEmbed('Make Me IT button').catch((error) => {
            console.error('[ChatTag] Failed to refresh Chat Tag-owned embed after Make Me IT:', error);
          });
          return ephemeral(`✅ ${clickerName} is now IT!`);
        }

        if (customId.startsWith('chattag_clearimmunity_')) {
          const { clearAllImmunity } = await import('@/lib/chat-tag-service');
          await clearAllImmunity();
          await refreshChatTagEmbed('clear immunity button').catch((error) => {
            console.error('[ChatTag] Failed to refresh Chat Tag-owned embed after clearing immunity:', error);
          });
          return ephemeral('✅ All immunity cleared!');
        }

        if (customId.startsWith('chattag_triggerffa_')) {
          const response = await fetch(`${getChatTagApiBase()}/api/tag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bot-secret': CHAT_TAG_SERVICE_SECRET },
            body: JSON.stringify({ action: 'trigger-ffa', performedBy: 'discord-admin' }),
          });
          if (!response.ok) {
            return ephemeral(`❌ Free-for-all failed: ${response.status}`);
          }
          await refreshChatTagEmbed('free-for-all button').catch((error) => {
            console.error('[ChatTag] Failed to refresh Chat Tag-owned embed after FFA:', error);
          });
          return ephemeral('🔥 Free-for-all triggered. Anyone can tag for double points.');
        }

        if (customId.startsWith('chattag_newcard_')) {
          const { generateNewBingoCard } = await import('@/lib/chat-tag-service');
          const res = await generateNewBingoCard();
          const note = res?.aiGenerated ? '(AI-generated!)' : '(shuffled phrases)';
          return ephemeral(`✅ New bingo card generated ${note}!`);
        }

        if (customId.startsWith('chattag_logs_')) {
          const { fetchLogs } = await import('@/lib/chat-tag-service');
          const logs = await fetchLogs();
          const logsUrl = `${getChatTagApiBase()}/api/logs`;
          return ephemeral(`📋 **Recent Logs:**\n\`\`\`\n${logs}\n\`\`\`\n🔗 [Live Logs](${logsUrl})`);
        }
      }

      if (customId.startsWith('partner_schedule_refresh_')) {
        const parts = customId.replace('partner_schedule_refresh_', '').split('_');
        const userId = parts[0];
        const serverId = parts[1];

        // Re-fetch Twitch schedule
        const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        if (userData?.twitchId) {
          const { fetchTwitchSchedule } = await import('@/lib/partner-schedule-service');
          const segments = await fetchTwitchSchedule(userData.twitchId, '');
          
          const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents');
          const batch = db.batch();
          
          // Clear only Twitch events
          const oldTwitchEvents = await eventsRef.where('type', '==', 'stream').get();
          oldTwitchEvents.docs.forEach((doc: { ref: any }) => batch.delete(doc.ref));
          
          // Add new Twitch events
          segments.forEach(seg => {
            const docRef = eventsRef.doc();
            batch.set(docRef, {
              eventName: seg.title,
              description: 'Twitch Stream',
              eventDateTime: new Date(seg.start_time),
              type: 'stream',
              isRecurring: seg.is_recurring
            });
          });
          
          await batch.commit();
        }

        // Re-fetch Google Calendar if URL exists
        const googleUrlDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
        const googleIcalUrl = googleUrlDoc.data()?.googleIcalUrl;
        
        if (googleIcalUrl) {
          try {
            const response = await fetch(googleIcalUrl);
            if (response.ok) {
              const icalData = await response.text();
              const events: any[] = [];
              const eventBlocks = icalData.split('BEGIN:VEVENT');
              
              for (let i = 1; i < eventBlocks.length && i <= 25; i++) {
                const block = eventBlocks[i];
                const summaryMatch = block.match(/SUMMARY:(.+)/);
                const startMatch = block.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
                
                if (summaryMatch && startMatch) {
                  const dateStr = startMatch[1];
                  const year = dateStr.substring(0, 4);
                  const month = dateStr.substring(4, 6);
                  const day = dateStr.substring(6, 8);
                  const hour = dateStr.substring(9, 11);
                  const minute = dateStr.substring(11, 13);
                  
                  events.push({
                    eventName: summaryMatch[1].trim(),
                    description: 'Google Calendar',
                    eventDateTime: new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`),
                    type: 'google',
                    isRecurring: false
                  });
                }
              }

              const batch = db.batch();
              const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents');
              
              // Clear old Google events
              const oldGoogleEvents = await eventsRef.where('type', '==', 'google').get();
              oldGoogleEvents.docs.forEach((doc: { ref: any }) => batch.delete(doc.ref));
              
              // Add new Google events
              events.forEach(event => {
                const docRef = eventsRef.doc();
                batch.set(docRef, event);
              });
              
              await batch.commit();
            }
          } catch (error) {
            console.error('[PartnerRefresh] Failed to refresh Google Calendar:', error);
          }
        }

        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        const embed = await generateScheduleEmbed(userId, serverId, { 
          channelId: body.channel_id, 
          messageId: body.message?.id 
        });

        if (embed) {
          const messageId = body.message?.id;
          const channelId = body.channel_id;
          const botToken = process.env.DISCORD_BOT_TOKEN;

          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(embed)
          });

          return ephemeral('✅ Calendar refreshed with latest Twitch and Google data!');
        }
        return ephemeral('⚠️ Failed to refresh calendar.');
      }

      if (customId.startsWith('partner_schedule_add_')) {
        const parts = customId.replace('partner_schedule_add_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const clickerId = body.member?.user?.id || body.user?.id;

        if (clickerId !== ownerId) {
          return ephemeral('🚫 Only the calendar owner can add events.');
        }

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `partner_schedule_add_modal_${ownerId}_${serverId}`,
            title: 'Add Custom Event',
            components: [
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'event_name',
                  label: 'Event Name',
                  style: 1,
                  required: true,
                  max_length: 80
                }]
              },
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'event_date',
                  label: 'Date (YYYY-MM-DD)',
                  style: 1,
                  required: true,
                  value: format(new Date(), 'yyyy-MM-dd')
                }]
              },
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'event_time',
                  label: 'Time (HH:MM)',
                  style: 1,
                  required: true,
                  value: '12:00'
                }]
              }
            ]
          }
        });
      }

      if (customId.startsWith('partner_schedule_seturl_')) {
        const parts = customId.replace('partner_schedule_seturl_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const clickerId = body.member?.user?.id || body.user?.id;

        if (clickerId !== ownerId) {
          return ephemeral('🚫 Only the calendar owner can sync calendars.');
        }

        return ephemeral('📅 **How to sync Google Calendar:**\n\n1. Go to [Google Calendar Settings](https://calendar.google.com/calendar/u/0/r/settings)\n2. Click on your calendar name\n3. Scroll to "Integrate calendar"\n4. Copy the **Secret address in iCal format**\n5. Click the button below and paste the URL\n\n⚠️ Keep this URL private - anyone with it can see your calendar!', {
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 5,
              label: '🔗 Open Google Calendar Settings',
              url: 'https://calendar.google.com/calendar/u/0/r/settings'
            }, {
              type: 2,
              style: 1,
              label: '📝 Paste iCal URL',
              custom_id: `partner_paste_ical_${ownerId}_${serverId}`
            }]
          }]
        });
      }

      if (customId.startsWith('partner_paste_ical_')) {
        const parts = customId.replace('partner_paste_ical_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `partner_schedule_seturl_modal_${ownerId}_${serverId}`,
            title: 'Sync Google Calendar',
            components: [
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'google_ical_url',
                  label: 'Google Calendar iCal URL',
                  style: 2,
                  required: true,
                  placeholder: 'https://calendar.google.com/calendar/ical/...'
                }]
              }
            ]
          }
        });
      }

      if (customId.startsWith('partner_schedule_username_')) {
        const parts = customId.replace('partner_schedule_username_', '').split('_');
        const userId = parts[0];
        const serverId = parts[1];
        const threadId = parts[2];

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `partner_schedule_modal_${userId}_${serverId}_${threadId}`,
            title: 'Connect Twitch Schedule',
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'twitch_username',
                    label: 'Twitch Username',
                    style: 1,
                    min_length: 3,
                    max_length: 25,
                    required: true,
                    placeholder: 'Enter your Twitch username'
                  },
                ],
              },
            ],
          },
        });
      }

      if (customId.startsWith('calendar_captain_log_')) {
        const serverId = customId.replace('calendar_captain_log_', '');
        const todayIso = new Date().toISOString().slice(0, 10);

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `calendar_captain_log_modal_${serverId}`,
            title: "Captain's Log Signup",
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'log_date',
                    label: 'Flight Date (YYYY-MM-DD)',
                    style: 1,
                    min_length: 10,
                    max_length: 10,
                    required: true,
                    value: todayIso,
                  },
                ],
              },
            ],
          },
        });
      }

      if (customId.startsWith('calendar_add_mission_')) {
        const serverId = customId.replace('calendar_add_mission_', '');
        const todayIso = new Date().toISOString().slice(0, 10);

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `calendar_add_mission_modal_${serverId}`,
            title: 'Add Mission',
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_name',
                    label: 'Mission Name',
                    style: 1,
                    min_length: 3,
                    max_length: 80,
                    required: true,
                  },
                ],
              },
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_description',
                    label: 'Mission Briefing',
                    style: 2,
                    min_length: 5,
                    max_length: 400,
                    required: true,
                  },
                ],
              },
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_date',
                    label: 'Date (YYYY-MM-DD)',
                    style: 1,
                    min_length: 10,
                    max_length: 10,
                    required: true,
                    value: todayIso,
                  },
                ],
              },
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_time',
                    label: 'Time (HH:MM, optional)',
                    style: 1,
                    min_length: 0,
                    max_length: 5,
                    required: false,
                  },
                ],
              },
            ],
          },
        });
      }

      if (customId.startsWith('calendar_prev_month_')) {
        const serverId = customId.replace('calendar_prev_month_', '');
        // Defer immediately — calendar generation takes time
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await shiftCalendarMonth(serverId, -1);
            const msg = result.success
              ? `📅 Calendar shifted to **${(result as any).monthLabel}**`
              : `⚠️ ${(result as any).message ?? 'Unable to update calendar.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] calendar_prev_month error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      if (customId.startsWith('calendar_next_month_')) {
        const serverId = customId.replace('calendar_next_month_', '');
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await shiftCalendarMonth(serverId, 1);
            const msg = result.success
              ? `📅 Calendar shifted to **${(result as any).monthLabel}**`
              : `⚠️ ${(result as any).message ?? 'Unable to update calendar.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] calendar_next_month error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      if (customId === 'check_rank' || customId.startsWith('check_rank_')) {
        const serverId = customId.startsWith('check_rank_')
          ? customId.replace('check_rank_', '')
          : body.guild_id;
        const userId = body.member?.user?.id || body.user?.id;
        const username = body.member?.user?.username || body.user?.username;

        if (!serverId) {
          return ephemeral('🚫 Unable to identify server.');
        }

        if (!userId) {
          return ephemeral('🚫 Unable to identify user.');
        }

        const leaderboardRef = db.collection('servers').doc(serverId).collection('leaderboard');
        const userDoc = await leaderboardRef.doc(userId).get();

        if (!userDoc.exists) {
          return ephemeral(`🛰️ **${username}**, you haven't earned any points yet! Start participating to climb the leaderboard! 🚀`);
        }

        const userData = userDoc.data();
        const userPoints = userData?.points || 0;
        const higherRankedSnapshot = await leaderboardRef.where('points', '>', userPoints).get();
        const rank = higherRankedSnapshot.size + 1;

        return ephemeral(`📊 **${username}**, you are rank #${rank} with ${userPoints.toLocaleString()} points!\n\n${rank <= 10 ? '🏆 You’re in the top 10! Great job!' : '🔭 Keep earning points to climb higher!'}`);
      }

      if (customId.startsWith('points_info_')) {
        const serverId = customId.replace('points_info_', '');
        const settingsDoc = await db.collection('servers').doc(serverId).collection('config').doc('leaderboardSettings').get();
        const s = settingsDoc.data() || {};
        return ephemeral(
          `**🏆 How Points Work**\n\n` +
          `**Twitch Activity:**\n` +
          `💬 Chat Message: **${s.chatActivityPoints ?? 1}** pts (1 per 5 min)\n` +
          `🌟 Subscription: **${s.subPoints ?? 50}** pts\n` +
          `🎁 Gift Sub: **${s.giftedSubPoints ?? 25}** pts\n` +
          `💎 Bits: **${s.bitPoints ?? 1}** pt per bit\n` +
          `🚀 Raid: **${s.raidPoints ?? 10}** pts\n\n` +
          `**Discord Activity:**\n` +
          `💬 Message: **${s.chatActivityPoints ?? 1}** pts (1 per 5 min)\n\n` +
          `**Admin Actions:**\n` +
          `📅 Calendar Event: **${s.adminEventPoints ?? 10}** pts\n` +
          `📘 Captain's Log: **${s.adminLogPoints ?? 5}** pts\n\n` +
          `*Keep chatting, subbing, and raiding to climb the leaderboard!*`
        );
      }

      if (customId.startsWith('crew_schedule_') || customId.startsWith('partner_schedule_')) {
        const twitchLogin = customId.replace(/^(crew|partner)_schedule_/, '').toLowerCase();
        const serverId = body.guild_id;

        if (!serverId || !twitchLogin) {
          return ephemeral('⚠️ Could not load schedule.');
        }

        const userSnap = await db
          .collection('servers')
          .doc(serverId)
          .collection('users')
          .where('twitchLogin', '==', twitchLogin)
          .limit(1)
          .get();

        if (userSnap.empty) {
          return ephemeral(`⚠️ No schedule found for ${twitchLogin}.`);
        }

        const userId = userSnap.docs[0].id;
        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        const schedulePayload = await generateScheduleEmbed(userId, serverId);

        if (!schedulePayload?.embeds?.length) {
          return ephemeral(`⚠️ ${twitchLogin}'s schedule is not available right now.`);
        }

        return ephemeral(`📅 ${twitchLogin}'s stream schedule`, {
          embeds: schedulePayload.embeds
        });
      }

      if (customId.startsWith('show_schedule_')) {
        const parts = customId.replace('show_schedule_', '').split('_');
        const serverId = parts.shift();
        const twitchLogin = parts.join('_').toLowerCase();

        if (!serverId || !twitchLogin) {
          return ephemeral('⚠️ Could not load schedule.');
        }

        // Defer immediately — schedule generation can be slow
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const userSnap = await db
              .collection('servers').doc(serverId)
              .collection('users').where('twitchLogin', '==', twitchLogin).limit(1).get();

            let msg: any = { content: `⚠️ No schedule found for ${twitchLogin}.` };
            if (!userSnap.empty) {
              const userId = userSnap.docs[0].id;
              const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
              const schedulePayload = await generateScheduleEmbed(userId, serverId);
              if (schedulePayload?.embeds?.length) {
                msg = { content: `📅 ${twitchLogin}'s stream schedule`, embeds: schedulePayload.embeds };
              } else {
                msg = { content: `⚠️ ${twitchLogin}'s schedule is not available right now.` };
              }
            }
            await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg)
            });
          } catch (e) {
            console.error('[Interactions] show_schedule error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      // ── Forwarded message buttons ──
      if (customId.startsWith('fwd_reply_')) {
        const originKey = customId.replace('fwd_reply_', '');
        return NextResponse.json({
          type: 9,
          data: {
            title: 'Reply to Original Message',
            custom_id: `fwd_reply_submit_${originKey}`,
            components: [{ type: 1, components: [{ type: 4, custom_id: 'reply_text', label: 'Your Reply', style: 2, placeholder: 'Type your reply here...', required: true, max_length: 2000 }] }]
          }
        });
      }

      if (customId.startsWith('fwd_react_')) {
        const originKey = customId.replace('fwd_react_', '');
        return NextResponse.json({
          type: 9,
          data: {
            title: 'Send a Reaction',
            custom_id: `fwd_react_submit_${originKey}`,
            components: [{ type: 1, components: [{ type: 4, custom_id: 'emoji_input', label: 'Emoji to React With', style: 1, placeholder: 'Paste a single emoji', required: true, max_length: 10 }] }]
          }
        });
      }

      if (customId.startsWith('fwd_remove_')) {
        const originKey = customId.replace('fwd_remove_', '');
        const [, originChannelId, originMessageId] = originKey.split('_');
        const forwardedMessageId = body.message.id;
        const forwardedChannelId = body.channel_id;
        const botToken = process.env.DISCORD_BOT_TOKEN;

        await fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        });

        await fetch(`https://discord.com/api/v10/channels/${forwardedChannelId}/messages/${forwardedMessageId}`, {
          method: 'DELETE', headers: { Authorization: `Bot ${botToken}` },
        }).catch(e => console.error('[FwdRemove] forwarded delete failed:', e));

        if (originChannelId && originMessageId) {
          await fetch(`https://discord.com/api/v10/channels/${originChannelId}/messages/${originMessageId}`, {
            method: 'DELETE', headers: { Authorization: `Bot ${botToken}` },
          }).catch(e => console.error('[FwdRemove] original delete failed:', e));
        }

        try {
          const homeServerId = getHardcodedGuildId() || '';
          await db.collection('servers').doc(homeServerId).collection('forwardedMessages').doc(forwardedMessageId).delete();
        } catch {}

        await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '🗑️ Both messages removed.' })
        });

        return new Response(null, { status: 200 });
      }

      const inquiryParts = customId.split(':');
      const legacyInquiryType = customId === 'apply_mod' ? 'mod' : customId === 'apply_partner' ? 'partner' : null;
      const inquiryType = legacyInquiryType || (inquiryParts[0] === 'application_inquiry' ? parseApplicationType(inquiryParts[1]) : null);
      if (inquiryType) {
        const serverId = inquiryParts[0] === 'application_inquiry' ? inquiryParts.slice(2).join(':') : body.guild_id;
        if (!serverId) return ephemeral('This inquiry is missing its SPMT server context.');
        await sendApplicationInquiry(body, inquiryType, serverId);
        return new Response(null, { status: 200 });
      }

      if (inquiryParts[0] === 'application_start') {
        const type = parseApplicationType(inquiryParts[1]);
        const serverId = inquiryParts.slice(2).join(':');
        if (!type || !serverId) return ephemeral('This application link is invalid or expired.');
        return NextResponse.json({ type: 9, data: buildApplicationModal(type, serverId) });
      }

      if (customId === 'apply_admin') {
        return NextResponse.json({
          type: 9,
          data: {
            title: 'Admin Application',
            custom_id: 'admin_application_submit',
            components: [
              { type: 1, components: [{ type: 4, custom_id: 'discord_experience', label: 'Discord Moderation Experience', style: 2, placeholder: 'Describe your experience', required: true, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: 'availability', label: 'Availability', style: 2, placeholder: 'When are you typically available?', required: true, max_length: 200 }] },
              { type: 1, components: [{ type: 4, custom_id: 'why_admin', label: 'Why do you want to be an admin?', style: 2, placeholder: 'What motivates you?', required: true, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: 'conflict_resolution', label: 'How would you handle conflicts?', style: 2, placeholder: 'Describe your approach', required: true, max_length: 500 }] }
            ]
          }
        });
      }
    }

    if (body.type === 5 && customId?.startsWith('hmo_watch_volume_submit:')) {
      const sessionId = normalizeHearMeOutSessionId(customId.split(':').slice(1).join(':'));
      const rawVolume = readModalValue(body.data, 'volume_value');
      const volume = Math.max(0, Math.min(100, Math.round(Number(rawVolume))));
      if (!Number.isFinite(volume)) return ephemeral('Volume must be a number from 0 to 100.');
      const applicationId = body.application_id || getDiscordClientId();
      runHearMeOutWatchControl('volume', sessionId, {
        userId: body.member?.user?.id || body.user?.id,
        guildId: body.guild_id,
        channelId: body.channel_id,
        isAdmin: discordMemberCanManageWatch(body.member),
      }, volume)
        .then((result) => updateDeferredInteraction(applicationId, body.token, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`))
        .catch((error) => updateDeferredInteraction(applicationId, body.token, `❌ ${error?.message || 'HearMeOut volume request failed.'}`));

      return NextResponse.json({
        type: 5,
        data: { content: `Setting HearMeOut volume to ${volume}%...`, flags: 64 },
      });
    }

    if (body.type === 5 && customId) {
      const userId = body.member?.user?.id || body.user?.id;
      if (!userId) {
        return ephemeral('🚫 Unable to identify user.');
      }

      if (customId === 'spmt_onboard_submit') {
        const discordUser = body.member?.user || body.user || {};
        const values = extractValues(body.data?.components);
        const preferredDisplayName = String(values.display_name || body.member?.nick || discordUser.global_name || discordUser.username || '').trim();
        const twitchUsername = String(values.twitch_username || '').trim().toLowerCase();
        if (twitchUsername && !/^[a-z0-9_]{3,25}$/.test(twitchUsername)) {
          return ephemeral('⚠️ Twitch usernames may contain only letters, numbers, and underscores.');
        }

        const grandfathered = await grandfatherDiscordIdentity({
          discordId: String(userId),
          discordUsername: String(discordUser.username || userId),
          displayName: preferredDisplayName || String(discordUser.username || userId),
          issueSession: false,
        });
        if (!grandfathered?.user) {
          return ephemeral('⚠️ SPMT onboarding is temporarily unavailable. Your Discord account was not changed; please try again shortly.');
        }

        let twitchUser: any = null;
        if (twitchUsername) {
          const { getUserByLogin } = await import('@/lib/twitch-api-service');
          twitchUser = await getUserByLogin(twitchUsername);
          if (!twitchUser) return ephemeral(`⚠️ Twitch user "${twitchUsername}" was not found. Your SPMT account is ready; use the setup button again to add Twitch later.`);
        }

        const serverId = String(body.guild_id || getHardcodedGuildId());
        const roles: string[] = Array.isArray(body.member?.roles) ? body.member.roles : [];
        const serverDoc = await db.collection('servers').doc(serverId).get();
        const roleMappings = serverDoc.data()?.roleMappings || {};
        let group = 'Community';
        for (const [roleId, groupName] of Object.entries(roleMappings)) {
          if (roles.includes(roleId)) { group = String(groupName); break; }
        }

        const profile: Record<string, unknown> = {
          discordUserId: String(userId),
          username: String(discordUser.username || userId),
          displayName: preferredDisplayName || String(discordUser.username || userId),
          roles,
          group,
          spmtUserId: grandfathered.user.id,
          spmtUsername: grandfathered.user.username,
          spmtCredentialState: 'provider-owned',
          spmtOnboardedAt: new Date(),
          isOnline: false,
        };
        if (twitchUser) {
          profile.twitchLogin = twitchUsername;
          profile.twitchId = twitchUser.id;
          profile.twitchLinkSource = 'discord-profile-claim';
          profile.linkedAt = new Date();
        }
        await db.collection('servers').doc(serverId).collection('users').doc(String(userId)).set(profile, { merge: true });
        await db.collection('servers').doc(serverId).collection('recentActivity').add({
          type: 'spmt_onboard',
          discordUserId: String(userId),
          spmtUserId: grandfathered.user.id,
          twitchLogin: twitchUsername || null,
          timestamp: new Date(),
        });

        const twitchLine = twitchUser ? `\nTwitch: **${twitchUsername}** (public shoutout tracking enabled)` : '\nYou can add a Twitch username later for live shoutouts.';
        return ephemeral(`✅ Your SPMT identity **${grandfathered.user.username}** is ready.${twitchLine}\n\nNo password was sent through Discord. Commands, points, and app activity can now use your Discord-linked SPMT identity.`);
      }

      if (customId.startsWith('link_twitch_modal_')) {
        const serverId = customId.replace('link_twitch_modal_', '');
        const values = extractValues(body.data?.components);
        const twitchUsername = String(values.twitch_username || '').trim().replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{3,25}$/.test(twitchUsername)) {
          console.warn(`[DiscordInteraction] twitch-link rejected reason=invalid-login guild=${serverId} user=${userId}`);
          return ephemeral('⚠️ Twitch usernames may contain only letters, numbers, and underscores.');
        }
        
        // Fetch Discord user info
        const botToken = process.env.DISCORD_BOT_TOKEN;
        const guildMemberRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/members/${userId}`, {
          headers: { 'Authorization': `Bot ${botToken}` }
        });
        
        if (!guildMemberRes.ok) {
          console.error(`[DiscordInteraction] twitch-link failed reason=discord-member status=${guildMemberRes.status} guild=${serverId} user=${userId}`);
          return ephemeral('⚠️ Failed to fetch your Discord info.');
        }
        
        const memberData = await guildMemberRes.json();
        const roles = memberData.roles || [];
        
        // Fetch Twitch user info
        const { getUserByLogin } = await import('@/lib/twitch-api-service');
        const twitchUser = await getUserByLogin(twitchUsername);
        
        if (!twitchUser) {
          console.warn(`[DiscordInteraction] twitch-link rejected reason=twitch-not-found twitch=${twitchUsername} guild=${serverId} user=${userId}`);
          return ephemeral(`⚠️ Twitch user "${twitchUsername}" not found.`);
        }

        const grandfathered = await grandfatherDiscordIdentity({
          discordId: String(userId),
          discordUsername: String(memberData.user.username || userId),
          displayName: String(memberData.nick || memberData.user.global_name || memberData.user.username || userId),
          issueSession: false,
        });
        
        // Determine group based on roles
        const serverDoc = await db.collection('servers').doc(serverId).get();
        const roleMappings = serverDoc.data()?.roleMappings || {};
        
        let group = 'Community';
        for (const [roleId, groupName] of Object.entries(roleMappings)) {
          if (roles.includes(roleId)) {
            group = groupName as string;
            break;
          }
        }
        
        // Create/update user document
        await db.collection('servers').doc(serverId).collection('users').doc(userId).set({
          discordUserId: userId,
          username: memberData.user.username,
          displayName: memberData.nick || memberData.user.global_name || memberData.user.username,
          avatarUrl: memberData.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${userId}/${memberData.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png',
          twitchLogin: twitchUsername,
          twitchId: twitchUser.id,
          group,
          roles,
          isOnline: false,
          linkedAt: new Date(),
          twitchLinkSource: 'discord-link-modal',
          ...(grandfathered?.user ? {
            spmtUserId: grandfathered.user.id,
            spmtUsername: grandfathered.user.username,
            spmtCredentialState: 'provider-owned',
            spmtOnboardedAt: new Date(),
          } : {})
        }, { merge: true });
        
        // Log linking activity to dashboard recents
        await db.collection('servers').doc(serverId).collection('recentActivity').add({
          type: 'twitch_link',
          discordUserId: userId,
          discordUsername: memberData.user.username,
          twitchLogin: twitchUsername,
          twitchId: twitchUser.id,
          group,
          timestamp: new Date()
        });

        console.log(`[DiscordInteraction] twitch-link success twitch=${twitchUsername} guild=${serverId} user=${userId} group=${group}`);
        
        return ephemeral(`✅ Successfully linked Twitch account **${twitchUsername}**!\n\nYou'll get automatic shoutouts when you go live.\nGroup: **${group}**${grandfathered?.user ? `\nSPMT: **${grandfathered.user.username}**` : '\nSPMT setup is temporarily unavailable; Twitch linking still succeeded.'}`);
      }

      if (customId.startsWith('partner_schedule_add_modal_')) {
        const parts = customId.replace('partner_schedule_add_modal_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const values = extractValues(body.data?.components);

        const eventDateTime = new Date(`${values.event_date}T${values.event_time}`);
        await db.collection('servers').doc(serverId).collection('users').doc(ownerId).collection('scheduleEvents').add({
          eventName: values.event_name,
          description: 'Custom Event',
          eventDateTime,
          type: 'custom',
          isRecurring: false
        });

        // Auto-refresh calendar
        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        const embed = await generateScheduleEmbed(ownerId, serverId, {
          channelId: body.channel_id,
          messageId: body.message?.id
        });

        if (embed) {
          const messageId = body.message?.id;
          const channelId = body.channel_id;
          const botToken = process.env.DISCORD_BOT_TOKEN;

          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(embed)
          });
        }

        return ephemeral('✅ Event added and calendar refreshed!');
      }

      if (customId.startsWith('partner_schedule_seturl_modal_')) {
        const parts = customId.replace('partner_schedule_seturl_modal_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const values = extractValues(body.data?.components);
        const icalUrl = values.google_ical_url;

        try {
          const response = await fetch(icalUrl);
          if (!response.ok) throw new Error('Invalid iCal URL');
          
          const icalData = await response.text();
          const events: any[] = [];
          const eventBlocks = icalData.split('BEGIN:VEVENT');
          
          for (let i = 1; i < eventBlocks.length && i <= 25; i++) {
            const block = eventBlocks[i];
            const summaryMatch = block.match(/SUMMARY:(.+)/);
            const startMatch = block.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
            
            if (summaryMatch && startMatch) {
              const dateStr = startMatch[1];
              const year = dateStr.substring(0, 4);
              const month = dateStr.substring(4, 6);
              const day = dateStr.substring(6, 8);
              const hour = dateStr.substring(9, 11);
              const minute = dateStr.substring(11, 13);
              
              events.push({
                eventName: summaryMatch[1].trim(),
                description: 'Google Calendar',
                eventDateTime: new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`),
                type: 'google',
                isRecurring: false
              });
            }
          }

          const batch = db.batch();
          const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(ownerId).collection('scheduleEvents');
          
          events.forEach(event => {
            const docRef = eventsRef.doc();
            batch.set(docRef, event);
          });
          
          await batch.commit();

          // Store Google iCal URL for future refreshes
          await db.collection('servers').doc(serverId).collection('users').doc(ownerId).update({
            googleIcalUrl: icalUrl
          });

          // Auto-refresh calendar
          const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
          const embed = await generateScheduleEmbed(ownerId, serverId, {
            channelId: body.channel_id,
            messageId: body.message?.id
          });

          if (embed) {
            const messageId = body.message?.id;
            const channelId = body.channel_id;
            const botToken = process.env.DISCORD_BOT_TOKEN;

            await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(embed)
          });
          }

          return ephemeral(`✅ Synced ${events.length} events from Google Calendar and refreshed!`);
        } catch (error) {
          return ephemeral('⚠️ Invalid Google Calendar URL. Make sure it\'s the iCal format.');
        }
      }

      if (customId.startsWith('partner_schedule_modal_')) {
        const parts = customId.replace('partner_schedule_modal_', '').split('_');
        const userId = parts[0];
        const serverId = parts[1];
        const threadId = parts[2];
        const values = extractValues(body.data?.components);
        const twitchUsername = values.twitch_username;

        console.log('[PartnerUsername] Storing username:', twitchUsername, 'for user:', userId);

        await db.collection('servers').doc(serverId).collection('users').doc(userId).update({
          twitchLogin: twitchUsername
        });

        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        console.log('[PartnerUsername] Generating schedule embed...');
        const embed = await generateScheduleEmbed(userId, serverId);
        console.log('[PartnerUsername] Embed generated:', !!embed);

        if (embed) {
          console.log('[PartnerUsername] Posting to thread:', threadId);
          const { postDiscordMessage } = await import('@/lib/discord-sync-service');
          await postDiscordMessage(serverId, threadId, embed);
          console.log('[PartnerUsername] Calendar posted successfully!');
          return ephemeral('✅ Your stream schedule calendar has been posted!');
        } else {
          return ephemeral('⚠️ Failed to generate calendar. Please try again.');
        }
      }

      if (customId.startsWith('calendar_captain_log_modal_')) {
        const serverId = customId.replace('calendar_captain_log_modal_', '');
        const values = extractValues(body.data?.components);
        // Defer — submitCaptainLog regenerates calendar image
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await submitCaptainLog({ serverId, userId, selectedDate: values.log_date });
            const msg = (result as any).success ? `✅ ${(result as any).message}` : `⚠️ ${(result as any).error || 'Failed to save captain log.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] captain_log_modal error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      if (customId.startsWith('calendar_add_mission_modal_')) {
        const serverId = customId.replace('calendar_add_mission_modal_', '');
        const values = extractValues(body.data?.components);
        // Defer — submitMission regenerates calendar image
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await submitMission({
              serverId, userId,
              missionName: values.mission_name,
              missionDescription: values.mission_description,
              missionDate: values.mission_date,
              missionTime: values.mission_time,
            });
            const msg = (result as any).success ? `✅ ${(result as any).message}` : `⚠️ ${(result as any).error || 'Failed to add mission.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] add_mission_modal error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      // ── Forwarded message modal submissions ──
      if (customId.startsWith('fwd_reply_submit_')) {
        const parts = customId.replace('fwd_reply_submit_', '').split('_');
        const originChannelId = parts[1];
        const originMessageId = parts[2];
        const replyText = body.data.components[0].components[0].value;
        const replierName = body.member?.user?.username || body.user?.username || 'Unknown';
        const botToken = process.env.DISCORD_BOT_TOKEN;

        await fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        });

        const replyBody: Record<string, unknown> = {
          content: `**${replierName}** replied:\n${replyText}`,
          allowed_mentions: { parse: [] },
        };
        if (originMessageId) {
          replyBody.message_reference = { message_id: originMessageId, channel_id: originChannelId };
        }

        await fetch(`https://discord.com/api/v10/channels/${originChannelId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(replyBody),
        });

        await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '✅ Reply sent to the original channel!' })
        });

        return new Response(null, { status: 200 });
      }

      if (customId.startsWith('fwd_react_submit_')) {
        const parts = customId.replace('fwd_react_submit_', '').split('_');
        const originChannelId = parts[1];
        const originMessageId = parts[2];
        const emoji = body.data.components[0].components[0].value.trim();
        const botToken = process.env.DISCORD_BOT_TOKEN;

        await fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        });

        const encoded = encodeURIComponent(emoji);
        await fetch(
          `https://discord.com/api/v10/channels/${originChannelId}/messages/${originMessageId}/reactions/${encoded}/@me`,
          { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } },
        );

        await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${body.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `✅ Reacted with ${emoji}!` })
        });

        return new Response(null, { status: 200 });
      }

      if (customId.startsWith('application_submit:')) {
        const [, rawType, ...serverParts] = customId.split(':');
        const type = parseApplicationType(rawType);
        const serverId = serverParts.join(':');
        if (!type || !serverId) return ephemeral('🚫 This application form is invalid or expired.');
        const definition = APPLICATION_DEFINITIONS[type];
        const actor = body.member?.user || body.user || {};
        const applications = await db.collection('servers').doc(serverId).collection('applications').get();
        const duplicate = applications.docs.find((doc: any) => {
          const data = doc.data();
          return String(data.userId) === String(userId) && data.type === type && data.status === 'pending';
        });
        if (duplicate) return ephemeral('⚠️ You already have a pending application for this role.');

        const values = extractValues(body.data?.components);
        const answers = definition.questions.map(question => ({
          id: question.id,
          question: question.label,
          answer: String(values[question.id] || '').trim(),
        }));
        await db.collection('servers').doc(serverId).collection('applications').add({
          type,
          flowVersion: APPLICATION_FLOW_VERSION,
          userId: String(userId),
          username: actor.username || String(userId),
          displayName: actor.global_name || actor.username || String(userId),
          avatarUrl: discordAvatarUrl(actor),
          answers,
          status: 'pending',
          submittedAt: new Date().toISOString(),
          agreementDocument: {
            title: definition.termsTitle,
            url: definition.termsUrl,
            hash: definition.termsHash,
          },
          stateHistory: [{ status: 'pending', at: new Date().toISOString(), actorId: String(userId) }],
        });
        return ephemeral(`✅ Your SPMT ${definition.name.toLowerCase()} application was submitted. Crew may advise, and the Owner makes the final decision.`);
      }

      if (customId === 'partner_application_submit') {
        const serverId = body.guild_id;
        const username = body.member?.user?.username || body.user?.username;
        const components = body.data.components;
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'partner', userId, username,
          communityName: components[0].components[0].value,
          communityFocus: components[1].components[0].value,
          whyPartner: components[2].components[0].value,
          contactInfo: components[3].components[0].value,
          status: 'pending', submittedAt: new Date()
        });
        return ephemeral('✅ Your partnership application has been submitted! We\'ll review it and get back to you soon.');
      }

      if (customId === 'mod_application_submit') {
        const serverId = body.guild_id;
        const username = body.member?.user?.username || body.user?.username;
        const components = body.data.components;
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'mod', userId, username,
          timezone: components[0].components[0].value,
          memberDuration: components[1].components[0].value,
          whyMod: components[2].components[0].value,
          streamersMeaning: components[3].components[0].value,
          status: 'pending', submittedAt: new Date()
        });
        return ephemeral('✅ Your mod team application has been submitted! We\'ll review it and get back to you soon.');
      }

      if (customId === 'admin_application_submit') {
        const serverId = body.guild_id;
        const username = body.member?.user?.username || body.user?.username;
        const components = body.data.components;
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'admin', userId, username,
          discordExperience: components[0].components[0].value,
          availability: components[1].components[0].value,
          whyAdmin: components[2].components[0].value,
          conflictResolution: components[3].components[0].value,
          status: 'pending', submittedAt: new Date()
        });
        return ephemeral('✅ Your admin application has been submitted! We\'ll review it and get back to you soon.');
      }
    }

    return NextResponse.json({ error: 'Unknown interaction' }, { status: 400 });
  } catch (error) {
    console.error('Discord interaction error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
