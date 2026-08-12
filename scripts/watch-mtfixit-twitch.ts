import 'dotenv/config';
import tmi from 'tmi.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { mtFixItPublicReply, parseMtFixItCommand } from '../src/lib/mtfixit-contract';
import { submitMtFixIt } from '../src/lib/mtfixit-service';

const CHANNEL_REFRESH_MS = 60_000;
const TOKEN_RETRY_MS = 5 * 60_000;
const CHANNEL_JOIN_RETRY_MS = 30 * 60_000;

const channelRetryAfter = new Map<string, number>();
let activeClient: tmi.Client | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

function readRuntimeConfig(): any {
  const candidates = [
    process.env.RUNTIME_CONFIG_FILE,
    '/data/runtime-config.json',
    join(process.cwd(), 'data', 'runtime-config.json'),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (error) {
      console.warn(`[MtFixIt:Twitch] Could not read runtime config ${candidate}:`, error);
    }
  }
  return {};
}

const runtimeConfig = readRuntimeConfig();
const serverId = String(
  process.env.HARDCODED_GUILD_ID
    || process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID
    || process.env.GUILD_ID
    || runtimeConfig?.publicIds?.hardcodedGuildId
    || '',
).trim();
const twitchClientId = String(
  process.env.TWITCH_CLIENT_ID
    || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID
    || runtimeConfig?.publicIds?.twitchClientId
    || '',
).trim();

function normalizeChannel(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/^#/, '');
}

async function getLiveChannels(): Promise<string[]> {
  const users = await db.collection('servers').doc(serverId).collection('users').get();
  const channels = new Set<string>();
  for (const user of users.docs) {
    const state = await user.ref.collection('shoutoutState').doc('current').get();
    if (!state.exists || !state.data()?.isLive) continue;
    const channel = normalizeChannel(user.data()?.twitchLogin);
    if (channel) channels.add(channel);
  }
  return [...channels];
}

async function getValidBotCredentials(): Promise<{ username: string; accessToken: string } | null> {
  const ref = db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth');
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  const username = String(data.botUsername || '').trim();
  const accessToken = String(data.accessToken || '').trim();
  const refreshToken = String(data.refreshToken || data.refresh_token || '').trim();
  const expiresAt = Number(data.expiresAt || 0);
  if (username && accessToken && Date.now() < expiresAt - 5 * 60_000) {
    return { username, accessToken };
  }
  if (!username || !refreshToken || !twitchClientId || !process.env.TWITCH_CLIENT_SECRET) return null;

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: twitchClientId,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) {
    console.error(`[MtFixIt:Twitch] Bot token refresh failed status=${response.status} payload=${JSON.stringify(payload)}`);
    return null;
  }

  const updated = {
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token || refreshToken),
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
    updatedAt: new Date().toISOString(),
    refreshErrorCode: null,
    refreshErrorAt: null,
    lastRefreshError: null,
  };
  await ref.set(updated, { merge: true });
  return { username, accessToken: updated.accessToken };
}

async function syncChannels(client: tmi.Client, joined: Set<string>) {
  if (activeClient !== client) return;
  const live = new Set((await getLiveChannels()).map(normalizeChannel).filter(Boolean));
  const now = Date.now();
  for (const channel of live) {
    if (joined.has(channel)) continue;
    const retryAt = channelRetryAfter.get(channel) || 0;
    if (retryAt > now) continue;
    try {
      await client.join(channel);
      joined.add(channel);
      channelRetryAfter.delete(channel);
      console.log(`[MtFixIt:Twitch] Joined #${channel}`);
    } catch (error) {
      channelRetryAfter.set(channel, now + CHANNEL_JOIN_RETRY_MS);
      console.warn(`[MtFixIt:Twitch] Could not join #${channel}; retrying later:`, error);
    }
  }
  for (const channel of [...joined]) {
    if (live.has(channel)) continue;
    channelRetryAfter.delete(channel);
    try {
      await client.part(channel);
    } catch (error) {
      console.warn(`[MtFixIt:Twitch] Could not part #${channel}:`, error);
    } finally {
      joined.delete(channel);
    }
    console.log(`[MtFixIt:Twitch] Parted #${channel}`);
  }
  for (const channel of [...channelRetryAfter.keys()]) if (!live.has(channel)) channelRetryAfter.delete(channel);
}

function clearRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function scheduleReconnect(reason: string) {
  if (reconnectTimer) return;
  console.warn(`[MtFixIt:Twitch] Reconnect scheduled: ${reason}`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void runWatcher().catch((error) => {
      console.error('[MtFixIt:Twitch] Reconnect failed:', error);
      scheduleReconnect('retry after reconnect failure');
    });
  }, TOKEN_RETRY_MS);
  reconnectTimer.unref?.();
}

async function runWatcher() {
  if (activeClient) return;
  if (!serverId) throw new Error('DSH guild/server ID is not configured.');
  const credentials = await getValidBotCredentials();
  if (!credentials) {
    console.warn('[MtFixIt:Twitch] Bot OAuth is unavailable; retrying later.');
    scheduleReconnect('bot OAuth unavailable');
    return;
  }

  const initialChannels = await getLiveChannels();
  const joined = new Set(initialChannels.map(normalizeChannel).filter(Boolean));
  const client = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: false },
    identity: { username: credentials.username, password: `oauth:${credentials.accessToken}` },
    channels: [...joined],
  });

  client.on('message', async (channel, tags, message, self) => {
    if (self) return;
    const description = parseMtFixItCommand(message);
    if (description === null) return;
    const targetChannel = normalizeChannel(channel);
    if (!description) {
      await client.say(`#${targetChannel}`, mtFixItPublicReply('usage')).catch(console.error);
      return;
    }

    const reporterId = String(tags['user-id'] || '').trim();
    const reporter = String(tags['display-name'] || tags.username || 'Twitch user').trim();
    if (!reporterId) return;
    try {
      await submitMtFixIt({
        source: 'twitch',
        reporter,
        reporterId,
        description,
        tenantId: serverId,
        channelId: targetChannel,
        channelName: targetChannel,
        messageId: String(tags.id || '').trim() || undefined,
      });
      await client.say(`#${targetChannel}`, mtFixItPublicReply('accepted'));
    } catch (error) {
      console.error('[MtFixIt:Twitch] Submission failed:', error);
      await client.say(`#${targetChannel}`, mtFixItPublicReply('failed')).catch(console.error);
    }
  });

  client.on('join', (channel) => joined.add(normalizeChannel(channel)));
  client.on('part', (channel) => joined.delete(normalizeChannel(channel)));
  client.on('disconnected', (reason) => {
    if (activeClient !== client) {
      console.warn(`[MtFixIt:Twitch] Ignoring stale disconnect: ${reason}`);
      return;
    }
    activeClient = null;
    clearRefreshTimer();
    console.warn(`[MtFixIt:Twitch] Disconnected: ${reason}`);
    scheduleReconnect(String(reason || 'disconnected'));
  });

  await client.connect();
  activeClient = client;
  console.log(`[MtFixIt:Twitch] Connected as ${credentials.username}; watching ${joined.size} live channel(s).`);
  clearRefreshTimer();
  refreshTimer = setInterval(() => {
    if (activeClient !== client) return;
    void syncChannels(client, joined).catch((error) => {
      console.warn('[MtFixIt:Twitch] Channel refresh query failed; will retry:', error);
    });
  }, CHANNEL_REFRESH_MS);
  refreshTimer.unref?.();
}

runWatcher().catch((error) => {
  console.error('[MtFixIt:Twitch] Fatal startup error:', error);
  activeClient = null;
  clearRefreshTimer();
  scheduleReconnect('fatal startup error');
});
