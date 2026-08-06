import 'dotenv/config';
import tmi from 'tmi.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { mtFixItPublicReply, parseMtFixItCommand } from '../src/lib/mtfixit-contract';
import { submitMtFixIt } from '../src/lib/mtfixit-service';

const CHANNEL_REFRESH_MS = 60_000;
const TOKEN_RETRY_MS = 5 * 60_000;

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
  const live = new Set((await getLiveChannels()).map(normalizeChannel).filter(Boolean));
  for (const channel of live) {
    if (joined.has(channel)) continue;
    await client.join(channel);
    joined.add(channel);
    console.log(`[MtFixIt:Twitch] Joined #${channel}`);
  }
  for (const channel of [...joined]) {
    if (live.has(channel)) continue;
    await client.part(channel);
    joined.delete(channel);
    console.log(`[MtFixIt:Twitch] Parted #${channel}`);
  }
}

async function runWatcher() {
  if (!serverId) throw new Error('DSH guild/server ID is not configured.');
  const credentials = await getValidBotCredentials();
  if (!credentials) {
    console.warn('[MtFixIt:Twitch] Bot OAuth is unavailable; retrying later.');
    setTimeout(() => runWatcher().catch(console.error), TOKEN_RETRY_MS).unref?.();
    return;
  }

  const initialChannels = await getLiveChannels();
  const joined = new Set(initialChannels.map(normalizeChannel).filter(Boolean));
  const client = new tmi.Client({
    options: { debug: false },
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
    console.warn(`[MtFixIt:Twitch] Disconnected: ${reason}`);
    setTimeout(() => runWatcher().catch(console.error), TOKEN_RETRY_MS).unref?.();
  });

  await client.connect();
  console.log(`[MtFixIt:Twitch] Connected as ${credentials.username}; watching ${joined.size} live channel(s).`);
  const timer = setInterval(() => syncChannels(client, joined).catch((error) => {
    console.error('[MtFixIt:Twitch] Channel refresh failed:', error);
  }), CHANNEL_REFRESH_MS);
  timer.unref?.();
}

runWatcher().catch((error) => {
  console.error('[MtFixIt:Twitch] Fatal startup error:', error);
  setTimeout(() => runWatcher().catch(console.error), TOKEN_RETRY_MS).unref?.();
});
