import { db } from '@/lib/db';
import { getAppUrl, getStoragePath, getStreamweaverUrl } from '@/lib/runtime-config';
import { getClipsForUser, getStreamByLogin, getUserByLogin } from '@/lib/twitch-api-service';
import { deleteDiscordMessage, editDiscordMessage, postDiscordMessage, sendShoutout } from '@/lib/discord-sync-service';
import { requestLiveBannerFromWorker } from '@/lib/live-banner-request-service';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';

type ManualDiscordShoutoutRecord = {
  id: string;
  messageId: string;
  channelId: string;
  twitchLogin: string;
  displayName: string;
  requesterName: string;
  requesterDiscordId?: string | null;
  targetName: string;
  targetDiscordUserId?: string | null;
  linkedDiscordUserId?: string | null;
  linkedGroup?: string | null;
  partnerDiscordLink?: string | null;
  aiShoutout: string;
  isLive: boolean;
  trackWhileLive: boolean;
  deleteAt?: string | null;
  lastConfirmedLiveAt?: string | null;
  offlineDetectedAt?: string | null;
  needsGif: boolean;
  lastGifRequestAt?: number | null;
  needsBanner: boolean;
  bannerRequestedAt?: number | null;
  currentGifIndex: number;
  sourceMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type RegisterManualDiscordShoutoutInput = {
  serverId: string;
  channelId: string;
  requesterName: string;
  requesterDiscordId?: string | null;
  targetName?: string;
  targetDiscordUserId?: string | null;
  sourceMessageId?: string | null;
};

type ResolvedManualTarget = {
  twitchLogin: string;
  displayName: string;
  linkedDiscordUserId: string | null;
  linkedGroup: string | null;
  partnerDiscordLink: string | null;
};

const MANUAL_COLLECTION = 'manualDiscordShoutouts';
const GIF_REQUEST_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const OFFLINE_DELETE_MS = 60 * 60 * 1000;
const LIVE_OFFLINE_GRACE_MS = 20 * 60 * 1000;
const BANNER_REQUEST_COOLDOWN_MS = 30 * 60 * 1000;
const STREAMWEAVER_SHARED_SECRET = String(process.env.STREAMWEAVER_SECRET || '').trim();

function manualCollection(serverId: string) {
  return db.collection('servers').doc(serverId).collection(MANUAL_COLLECTION);
}

function normalizeTwitchLogin(value: string): string {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .trim();
}

function buildManualShoutoutId(twitchLogin: string, channelId: string): string {
  const safeLogin = twitchLogin.replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'manual';
  const safeChannel = String(channelId || '').replace(/[^a-z0-9_]/gi, '').slice(0, 24) || 'channel';
  return `manual-${safeChannel}-${safeLogin}`;
}

function getStoredBannerUrl(twitchLogin: string): string | null {
  const bannerPath = join(getStoragePath(), 'banners', `${twitchLogin}.gif`);
  if (!existsSync(bannerPath)) return null;
  return `${getAppUrl().replace(/\/$/, '')}/api/media/banners/${twitchLogin}.gif?v=${Date.now()}`;
}

async function getStoredGifUrls(twitchLogin: string): Promise<string[]> {
  const streamerDir = join(getStoragePath(), twitchLogin);
  if (!existsSync(streamerDir)) return [];
  const files = (await readdir(streamerDir).catch(() => [] as string[]))
    .filter((file) => file.endsWith('.gif'))
    .sort();
  const appUrl = getAppUrl().replace(/\/$/, '');
  return files.map((file) => `${appUrl}/api/media/${twitchLogin}/${file}`);
}

async function getLinkedUserByDiscordId(serverId: string, discordUserId: string) {
  const doc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).get();
  if (!doc.exists) return null;
  return { id: discordUserId, ...(doc.data() || {}) };
}

async function getLinkedUserByTwitchLogin(serverId: string, twitchLogin: string) {
  const snapshot = await db.collection('servers').doc(serverId).collection('users')
    .where('twitchLogin', '==', twitchLogin)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const match = snapshot.docs[0];
  return { id: match.id, ...(match.data() || {}) };
}

function getDefaultAiShoutout(twitchLogin: string): string {
  return `Go check out ${twitchLogin} on Twitch.`;
}

function shouldRefreshAiShoutout(entry: ManualDiscordShoutoutRecord): boolean {
  return String(entry.aiShoutout || '').trim() === getDefaultAiShoutout(entry.twitchLogin);
}

async function resolveManualTarget(input: RegisterManualDiscordShoutoutInput): Promise<ResolvedManualTarget> {
  const targetDiscordUserId = String(input.targetDiscordUserId || '').trim();
  if (targetDiscordUserId) {
    const linked = await getLinkedUserByDiscordId(input.serverId, targetDiscordUserId);
    const twitchLogin = normalizeTwitchLogin(linked?.twitchLogin || '');
    if (!linked || !twitchLogin) {
      throw new Error('That Discord member is not linked to a Twitch account in DiscordStreamHub.');
    }

    const twitchUser = await getUserByLogin(twitchLogin);
    return {
      twitchLogin,
      displayName: twitchUser?.display_name || linked.displayName || linked.username || twitchLogin,
      linkedDiscordUserId: linked.id,
      linkedGroup: typeof linked.group === 'string' ? linked.group : null,
      partnerDiscordLink: typeof linked.partnerDiscordLink === 'string' ? linked.partnerDiscordLink : null,
    };
  }

  const twitchLogin = normalizeTwitchLogin(input.targetName || '');
  if (!twitchLogin) {
    throw new Error('Missing target Twitch username.');
  }

  const twitchUser = await getUserByLogin(twitchLogin);
  if (!twitchUser) {
    throw new Error(`Twitch user not found: ${twitchLogin}`);
  }

  const linked = await getLinkedUserByTwitchLogin(input.serverId, twitchLogin);
  return {
    twitchLogin,
    displayName: twitchUser.display_name || linked?.displayName || linked?.username || twitchLogin,
    linkedDiscordUserId: linked?.id || null,
    linkedGroup: typeof linked?.group === 'string' ? linked.group : null,
    partnerDiscordLink: typeof linked?.partnerDiscordLink === 'string' ? linked.partnerDiscordLink : null,
  };
}

async function getAiShoutout(twitchLogin: string, serverId: string): Promise<string> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (STREAMWEAVER_SHARED_SECRET) {
      headers.Authorization = `Bearer ${STREAMWEAVER_SHARED_SECRET}`;
    }

    const response = await fetch(`${getStreamweaverUrl().replace(/\/$/, '')}/api/ai/shoutout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: twitchLogin, tenantId: serverId }),
      cache: 'no-store',
    });
    if (!response.ok) {
      return getDefaultAiShoutout(twitchLogin);
    }
    const data = await response.json().catch(() => null);
    const shoutout = String(data?.shoutout || data?.data?.shoutout || '').trim();
    return shoutout || getDefaultAiShoutout(twitchLogin);
  } catch {
    return getDefaultAiShoutout(twitchLogin);
  }
}

function getManualEmbedColor(group?: string | null): number {
  if (group === 'Crew') return 0x00d9ff;
  if (group === 'Partners') return 0x8b00ff;
  return 0x14b8a6;
}

async function buildManualPayload(entry: ManualDiscordShoutoutRecord): Promise<{
  payload: any;
  isLive: boolean;
  hasGif: boolean;
  hasBanner: boolean;
  nextGifIndex: number;
}> {
  const [twitchUser, stream, gifUrls] = await Promise.all([
    getUserByLogin(entry.twitchLogin).catch(() => null),
    getStreamByLogin(entry.twitchLogin).catch(() => null),
    getStoredGifUrls(entry.twitchLogin).catch(() => [] as string[]),
  ]);

  const hasGif = gifUrls.length > 0;
  const currentGifIndex = hasGif ? (entry.currentGifIndex % gifUrls.length) : 0;
  const gifUrl = hasGif ? gifUrls[currentGifIndex] : null;
  const nextGifIndex = hasGif ? (currentGifIndex + 1) % gifUrls.length : entry.currentGifIndex;
  const hasBanner = Boolean(getStoredBannerUrl(entry.twitchLogin));
  const bannerUrl = hasBanner ? getStoredBannerUrl(entry.twitchLogin) : null;
  const isLive = Boolean(stream);
  const displayName = twitchUser?.display_name || entry.displayName || entry.twitchLogin;
  const twitchUrl = `https://twitch.tv/${entry.twitchLogin}`;
  const previewUrl = stream?.thumbnail_url
    ? stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
    : null;
  const clipThumbnailUrl = (!gifUrl && !previewUrl && twitchUser?.id)
    ? await getClipsForUser(twitchUser.id, 3)
      .then((clips) => clips.find((clip) => String(clip?.thumbnail_url || '').trim())?.thumbnail_url || null)
      .catch(() => null)
    : null;
  const imageUrl = gifUrl || previewUrl || clipThumbnailUrl || twitchUser?.profile_image_url || null;

  console.log(
    `[ManualDiscordShoutout] Payload for ${entry.twitchLogin}: live=${isLive} gifs=${gifUrls.length} currentGifIndex=${currentGifIndex} banner=${hasBanner ? 'yes' : 'no'}`
  );

  const embeds: any[] = [];
  if (bannerUrl) {
    embeds.push({
      image: { url: bannerUrl },
      color: getManualEmbedColor(entry.linkedGroup),
    });
  }

  embeds.push({
    author: {
      name: `${displayName} Manual Shoutout`,
      url: twitchUrl,
      icon_url: twitchUser?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png',
    },
    title: isLive ? `${displayName} is LIVE on Twitch` : `Shoutout for ${displayName}`,
    description: entry.aiShoutout,
    url: twitchUrl,
    color: getManualEmbedColor(entry.linkedGroup),
    fields: [
      {
        name: isLive ? 'Playing' : 'Status',
        value: isLive ? (stream?.game_name || 'Unknown') : 'Offline',
        inline: true,
      },
      {
        name: 'Viewers',
        value: isLive ? String(stream?.viewer_count || 0) : 'Offline',
        inline: true,
      },
      {
        name: 'Called By',
        value: `@${entry.requesterName}`,
        inline: true,
      },
    ],
    thumbnail: {
      url: twitchUser?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png',
    },
    ...(imageUrl ? { image: { url: imageUrl } } : {}),
    footer: {
      text: entry.trackWhileLive
        ? 'Discord manual shoutout • refreshes every 10 minutes while live'
        : 'Discord manual shoutout • posted while offline',
    },
    timestamp: new Date().toISOString(),
  });

  const buttons = [
    {
      type: 2,
      style: 5,
      label: 'Watch on Twitch',
      url: twitchUrl,
      emoji: { name: '📺' },
    },
  ];

  if (entry.partnerDiscordLink) {
    buttons.push({
      type: 2,
      style: 5,
      label: 'Discord',
      url: entry.partnerDiscordLink,
      emoji: { name: '💬' },
    });
  }

  return {
    payload: {
      embeds,
      components: [
        {
          type: 1,
          components: buttons,
        },
      ],
    },
    isLive,
    hasGif,
    hasBanner,
    nextGifIndex,
  };
}

async function maybeRequestBanner(serverId: string, entry: ManualDiscordShoutoutRecord, hasBanner: boolean): Promise<void> {
  if (hasBanner || !entry.trackWhileLive || !entry.needsBanner) return;
  if (getStoredBannerUrl(entry.twitchLogin)) return;
  const now = Date.now();
  if (entry.bannerRequestedAt && now - entry.bannerRequestedAt < BANNER_REQUEST_COOLDOWN_MS) return;

  const accepted = await requestLiveBannerFromWorker(entry.twitchLogin);
  if (!accepted) {
    console.warn(`[ManualDiscordShoutout] Banner request not accepted for ${entry.twitchLogin}`);
    return;
  }

  await manualCollection(serverId).doc(entry.id).set({
    bannerRequestedAt: now,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

async function upsertManualRecord(serverId: string, entry: ManualDiscordShoutoutRecord): Promise<void> {
  await manualCollection(serverId).doc(entry.id).set(entry, { merge: false });
}

async function getExistingManualRecord(serverId: string, channelId: string, twitchLogin: string): Promise<ManualDiscordShoutoutRecord | null> {
  const snapshot = await manualCollection(serverId).get();
  const match = snapshot.docs
    .map((doc: any) => doc.data())
    .find((item: any) => item?.channelId === channelId && item?.twitchLogin === twitchLogin);
  return match ? (match as ManualDiscordShoutoutRecord) : null;
}

export async function registerManualDiscordShoutout(input: RegisterManualDiscordShoutoutInput): Promise<{
  messageId: string;
  isLive: boolean;
  twitchLogin: string;
}> {
  const resolved = await resolveManualTarget(input);
  const stream = await getStreamByLogin(resolved.twitchLogin);
  const aiShoutout = await getAiShoutout(resolved.twitchLogin, input.serverId);
  const gifUrls = await getStoredGifUrls(resolved.twitchLogin);
  const hasBanner = Boolean(getStoredBannerUrl(resolved.twitchLogin));
  const isLive = Boolean(stream);
  const nowIso = new Date().toISOString();
  const existing = await getExistingManualRecord(input.serverId, input.channelId, resolved.twitchLogin);

  const recordBase: ManualDiscordShoutoutRecord = {
    id: existing?.id || buildManualShoutoutId(resolved.twitchLogin, input.channelId),
    messageId: existing?.messageId || '',
    channelId: input.channelId,
    twitchLogin: resolved.twitchLogin,
    displayName: resolved.displayName,
    requesterName: input.requesterName,
    requesterDiscordId: input.requesterDiscordId || null,
    targetName: input.targetName || resolved.twitchLogin,
    targetDiscordUserId: input.targetDiscordUserId || null,
    linkedDiscordUserId: resolved.linkedDiscordUserId,
    linkedGroup: resolved.linkedGroup,
    partnerDiscordLink: resolved.partnerDiscordLink,
    aiShoutout,
    isLive,
    trackWhileLive: isLive,
    deleteAt: isLive ? null : new Date(Date.now() + OFFLINE_DELETE_MS).toISOString(),
    lastConfirmedLiveAt: isLive ? (existing?.lastConfirmedLiveAt || nowIso) : null,
    offlineDetectedAt: null,
    needsGif: isLive && gifUrls.length === 0,
    lastGifRequestAt: existing?.lastGifRequestAt || null,
    needsBanner: isLive && !hasBanner,
    bannerRequestedAt: existing?.bannerRequestedAt || null,
    currentGifIndex: existing?.currentGifIndex || 0,
    sourceMessageId: input.sourceMessageId || null,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const { payload, hasGif, hasBanner: payloadHasBanner, nextGifIndex } = await buildManualPayload(recordBase);
  const nextRecord: ManualDiscordShoutoutRecord = {
    ...recordBase,
    currentGifIndex: nextGifIndex,
    needsGif: recordBase.needsGif && !hasGif,
    needsBanner: recordBase.needsBanner && !payloadHasBanner,
  };

  let messageId = existing?.messageId || '';

  if (existing?.messageId) {
    try {
      await editDiscordMessage(input.serverId, input.channelId, existing.messageId, payload);
      messageId = existing.messageId;
    } catch {
      if (existing.messageId) {
        await deleteDiscordMessage(input.serverId, input.channelId, existing.messageId).catch(() => {});
      }
      messageId = await sendShoutout(input.serverId, input.channelId, payload) || '';
    }
  } else {
    messageId = await sendShoutout(input.serverId, input.channelId, payload) || '';
  }

  if (!messageId) {
    throw new Error('Failed to post manual shoutout to Discord.');
  }

  nextRecord.messageId = messageId;
  await upsertManualRecord(input.serverId, nextRecord);
  await maybeRequestBanner(input.serverId, nextRecord, payloadHasBanner);

  return {
    messageId,
    isLive,
    twitchLogin: resolved.twitchLogin,
  };
}

async function deleteManualRecord(serverId: string, entry: ManualDiscordShoutoutRecord): Promise<void> {
  if (entry.messageId) {
    await deleteDiscordMessage(serverId, entry.channelId, entry.messageId).catch(() => {});
  }
  await manualCollection(serverId).doc(entry.id).delete().catch(() => {});
}

async function updateManualRecord(serverId: string, entry: ManualDiscordShoutoutRecord): Promise<void> {
  const aiShoutout = shouldRefreshAiShoutout(entry)
    ? await getAiShoutout(entry.twitchLogin, serverId)
    : entry.aiShoutout;
  const nowIso = new Date().toISOString();
  const nextEntry: ManualDiscordShoutoutRecord = {
    ...entry,
    aiShoutout,
  };
  const { payload, isLive, hasGif, hasBanner, nextGifIndex } = await buildManualPayload(nextEntry);
  if (!isLive) {
    const offlineDetectedAt = nextEntry.offlineDetectedAt || nowIso;
    const offlineDetectedAtMs = new Date(offlineDetectedAt).getTime();
    const offlineForMs = offlineDetectedAtMs > 0 ? Date.now() - offlineDetectedAtMs : 0;
    if (offlineForMs < LIVE_OFFLINE_GRACE_MS) {
      await upsertManualRecord(serverId, {
        ...nextEntry,
        offlineDetectedAt,
        updatedAt: nowIso,
      });
      console.warn(
        `[ManualDiscordShoutout] Delaying delete for ${entry.twitchLogin}; offline grace ${Math.floor(offlineForMs / 1000)}s/${Math.floor(LIVE_OFFLINE_GRACE_MS / 1000)}s`
      );
      return;
    }

    await deleteManualRecord(serverId, {
      ...nextEntry,
      offlineDetectedAt,
    });
    return;
  }

  const nextRecord: ManualDiscordShoutoutRecord = {
    ...nextEntry,
    isLive: true,
    trackWhileLive: true,
    deleteAt: null,
    lastConfirmedLiveAt: nowIso,
    offlineDetectedAt: null,
    currentGifIndex: nextGifIndex,
    needsGif: entry.needsGif && !hasGif,
    needsBanner: entry.needsBanner && !hasBanner,
    updatedAt: nowIso,
  };

  try {
    await editDiscordMessage(serverId, entry.channelId, entry.messageId, payload);
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const shouldRepost = /30046|Unknown Message|404|MESSAGE_NOT_FOUND/i.test(errorText);
    if (!shouldRepost) throw error;

    await deleteDiscordMessage(serverId, entry.channelId, entry.messageId).catch(() => {});
    const newMessageId = await postDiscordMessage(serverId, entry.channelId, payload);
    if (!newMessageId) {
      throw new Error(`Failed to repost manual shoutout for ${entry.twitchLogin}`);
    }
    nextRecord.messageId = newMessageId;
  }

  await upsertManualRecord(serverId, nextRecord);
  await maybeRequestBanner(serverId, nextRecord, hasBanner);
}

export async function refreshManualDiscordShoutouts(serverId: string): Promise<void> {
  const snapshot = await manualCollection(serverId).get();
  if (snapshot.empty) return;

  const entries = snapshot.docs.map((doc: any) => doc.data() as ManualDiscordShoutoutRecord);
  const now = Date.now();

  for (const entry of entries) {
    try {
      if (!entry.trackWhileLive) {
        const deleteAtMs = entry.deleteAt ? new Date(entry.deleteAt).getTime() : 0;
        if (deleteAtMs > 0 && deleteAtMs <= now) {
          await deleteManualRecord(serverId, entry);
        }
        continue;
      }

      await updateManualRecord(serverId, entry);
    } catch (error) {
      console.warn(`[ManualDiscordShoutout] Refresh failed for ${entry.twitchLogin}:`, error);
    }
  }
}
