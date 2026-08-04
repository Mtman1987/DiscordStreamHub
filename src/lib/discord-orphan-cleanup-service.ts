'use server';

import { db } from '@/lib/db';

type DiscordMessage = {
  id: string;
  author?: { id?: string; bot?: boolean };
  embeds?: Array<{
    title?: string;
    description?: string;
    url?: string;
    footer?: { text?: string };
  }>;
  components?: Array<{
    components?: Array<{ custom_id?: string }>;
  }>;
};

type CleanupResult = {
  channelsChecked: number;
  messagesScanned: number;
  deleted: number;
  kept: number;
};

type CleanupOptions = {
  maxDeletesPerRun?: number;
};

type CleanupChannelInfo = {
  channelId: string;
  sources: string[];
};

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const RECENT_MESSAGE_LIMIT = 100;
const DEFAULT_MAX_DELETES_PER_RUN = 20;

export async function cleanupOrphanedDiscordEmbeds(serverId: string, options: CleanupOptions = {}): Promise<CleanupResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.log('[DiscordCleanup] DISCORD_BOT_TOKEN is not set; skipping orphan cleanup');
    return { channelsChecked: 0, messagesScanned: 0, deleted: 0, kept: 0 };
  }

  const botId = await getBotId(botToken);
  const keepMessageIds = await getTrackedMessageIds(serverId);
  const channelInfos = await getCleanupChannelInfos(serverId);
  const maxDeletes = Math.max(0, options.maxDeletesPerRun ?? DEFAULT_MAX_DELETES_PER_RUN);
  const result: CleanupResult = {
    channelsChecked: channelInfos.length,
    messagesScanned: 0,
    deleted: 0,
    kept: 0,
  };
  for (const channelInfo of channelInfos) {
    const { channelId } = channelInfo;
    const messages = await fetchRecentMessages(botToken, channelId);
    for (const message of messages) {
      result.messagesScanned += 1;
      if (!isManagedBotMessage(message, botId)) {
        continue;
      }
      if (keepMessageIds.has(message.id)) {
        result.kept += 1;
        continue;
      }
      if (!isCleanupTarget(message)) {
        continue;
      }

      await deleteDiscordMessage(botToken, channelId, message.id);
      result.deleted += 1;
      if (result.deleted >= maxDeletes) {
        console.log(`[DiscordCleanup] Deleted ${result.deleted} orphaned embeds; delete limit reached`);
        return result;
      }
      await delay(650);
    }
  }

  if (result.deleted > 0) {
    console.log(`[DiscordCleanup] Deleted ${result.deleted} orphaned embeds across ${result.channelsChecked} channels`);
  }
  return result;
}

async function getBotId(botToken: string): Promise<string | null> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!response.ok) {
    console.error('[DiscordCleanup] Failed to resolve bot identity:', response.status, await response.text().catch(() => ''));
    return null;
  }
  const body = await response.json();
  return typeof body?.id === 'string' ? body.id : null;
}

async function getTrackedMessageIds(serverId: string): Promise<Set<string>> {
  const keep = new Set<string>();
  const usersSnap = await db.collection('servers').doc(serverId).collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const stateDoc = await userDoc.ref.collection('shoutoutState').doc('current').get();
    const state = stateDoc.data();
    if (state?.isLive && typeof state.messageId === 'string') keep.add(state.messageId);
  }

  const pinnedDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('pinnedEmbed').get();
  const pinned = pinnedDoc.data();
  if (typeof pinned?.messageId === 'string') keep.add(pinned.messageId);

  for (const configDocId of ['linkingEmbed', 'leaderboardMessage']) {
    const configDoc = await db.collection('servers').doc(serverId).collection('config').doc(configDocId).get();
    const data = configDoc.data();
    if (typeof data?.messageId === 'string') keep.add(data.messageId);
  }

  const chatTagConfig = await db.collection('servers').doc(serverId).collection('config').doc('chatTag').get();
  const chatTag = chatTagConfig.data();
  if (typeof chatTag?.embedMessageId === 'string') keep.add(chatTag.embedMessageId);

  return keep;
}

async function getCleanupChannelInfos(serverId: string): Promise<CleanupChannelInfo[]> {
  const channels = new Map<string, Set<string>>();
  const groupChannelsDoc = await db.collection('servers').doc(serverId).collection('config').doc('groupChannels').get();
  const groupChannels = groupChannelsDoc.data() || {};
  for (const [groupName, value] of Object.entries(groupChannels)) {
    if (typeof value === 'string' && value !== serverId && isDiscordSnowflake(value)) {
      addChannelSource(channels, value, `groupChannels.${groupName}`);
    }
  }

  for (const [collectionName, docId] of [
    ['spotlight', 'pinnedEmbed'],
    ['config', 'linkingEmbed'],
    ['config', 'leaderboardMessage'],
    ['config', 'chatTag'],
  ] as const) {
    const doc = await db.collection('servers').doc(serverId).collection(collectionName).doc(docId).get();
    const data = doc.data();
    const channelId = data?.channelId;
    if (typeof channelId === 'string' && channelId !== serverId && isDiscordSnowflake(channelId)) {
      addChannelSource(channels, channelId, `${collectionName}.${docId}`);
    }
  }

  // Remove the server ID itself if it somehow got in (it's not a channel)
  channels.delete(serverId);

  return Array.from(channels.entries()).map(([channelId, sourceSet]) => ({
    channelId,
    sources: Array.from(sourceSet).sort(),
  }));
}

function addChannelSource(channels: Map<string, Set<string>>, channelId: string, source: string): void {
  const existing = channels.get(channelId) || new Set<string>();
  existing.add(source);
  channels.set(channelId, existing);
}

async function fetchRecentMessages(botToken: string, channelId: string): Promise<DiscordMessage[]> {
  if (!isDiscordSnowflake(channelId)) {
    console.warn(`[DiscordCleanup] Skipping invalid channel ID: ${channelId}`);
    return [];
  }
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${RECENT_MESSAGE_LIMIT}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!response.ok) {
    if (response.status === 404) return []; // Channel deleted, skip silently
    console.error('[DiscordCleanup] Failed to fetch messages:', channelId, response.status, await response.text().catch(() => ''));
    return [];
  }
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

function isManagedBotMessage(message: DiscordMessage, botId: string | null): boolean {
  if (!message.author?.bot) return false;
  return !botId || message.author.id === botId;
}

function isCleanupTarget(message: DiscordMessage): boolean {
  const text = message.embeds?.map((embed) => [
    embed.title,
    embed.description,
    embed.url,
    embed.footer?.text,
  ].filter(Boolean).join(' ')).join(' ') || '';

  if (/is now LIVE on Twitch|COMMUNITY SPOTLIGHT|Get Featured Stream Shoutouts|automatic stream shoutouts/i.test(text)) {
    return true;
  }

  return Boolean(message.components?.some((row) =>
    row.components?.some((component) => component.custom_id === 'link_twitch_account' || component.custom_id === 'spmt_join_recover')
  ));
}

async function deleteDiscordMessage(botToken: string, channelId: string, messageId: string): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (response.status === 429) {
    const body = await response.json().catch(() => ({ retry_after: 1 }));
    const retryAfterMs = Math.max(500, Number(body?.retry_after ?? 1) * 1000);
    console.warn(`[DiscordCleanup] Rate limited deleting ${messageId}, waiting ${retryAfterMs}ms`);
    await delay(retryAfterMs);
    // Retry once, then give up
    const retry = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (retry.ok || retry.status === 404) {
      console.log(`[DiscordCleanup] Deleted orphaned Discord message ${messageId} in ${channelId} (after retry)`);
    }
    return;
  }
  if (!response.ok && response.status !== 404) {
    console.error(`[DiscordCleanup] Failed to delete ${messageId} in ${channelId}: ${response.status}`);
    return; // Don't throw — don't crash startup
  }
  console.log(`[DiscordCleanup] Deleted orphaned Discord message ${messageId} in ${channelId}`);
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
