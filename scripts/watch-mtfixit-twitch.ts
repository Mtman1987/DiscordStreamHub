import 'dotenv/config';
import tmi from 'tmi.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { mtFixItPublicReply, parseMtFixItCommand, resolveTwitchMtFixItTenantId } from '../src/lib/mtfixit-contract';
import { submitMtFixItOrchestrated } from '../src/lib/mtfixit-orchestrator';
import { recordMtFixItOutcome, registerMtFixItDelivery, resumePendingMtFixItDeliveries } from '../src/lib/mtfixit-delivery';

const CHANNEL_REFRESH_MS = 60_000;
const TOKEN_RETRY_MS = 5 * 60_000;
const CHANNEL_RETRY_BASE_MS = 60_000;
const CHANNEL_RETRY_MAX_MS = 30 * 60_000;

type RetryState = { attempts: number; nextAt: number };
type LiveChannel = { channel: string; tenantId?: string };

function readRuntimeConfig(): any {
  const candidates = [process.env.RUNTIME_CONFIG_FILE, '/data/runtime-config.json', join(process.cwd(), 'data', 'runtime-config.json')].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')); }
    catch (error) { console.warn(`[MtFixIt:Twitch] Could not read runtime config ${candidate}:`, error); }
  }
  return {};
}

const runtimeConfig = readRuntimeConfig();
const serverId = String(process.env.HARDCODED_GUILD_ID || process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID || process.env.GUILD_ID || runtimeConfig?.publicIds?.hardcodedGuildId || '').trim();
const twitchClientId = String(process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || runtimeConfig?.publicIds?.twitchClientId || '').trim();

function normalizeChannel(value: string): string { return String(value || '').trim().toLowerCase().replace(/^#/, ''); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error || 'unknown error'); }
function scheduleRetry(retries: Map<string, RetryState>, channel: string) {
  const previous = retries.get(channel); const attempts = Math.min((previous?.attempts || 0) + 1, 10);
  const delay = Math.min(CHANNEL_RETRY_BASE_MS * (2 ** (attempts - 1)), CHANNEL_RETRY_MAX_MS);
  retries.set(channel, { attempts, nextAt: Date.now() + delay }); return delay;
}

async function getLiveChannels(): Promise<LiveChannel[]> {
  const users = await db.collection('servers').doc(serverId).collection('users').get(); const channels = new Map<string, LiveChannel>();
  for (const user of users.docs) {
    const state = await user.ref.collection('shoutoutState').doc('current').get(); if (!state.exists || !state.data()?.isLive) continue;
    const data = user.data() || {}; const channel = normalizeChannel(data.twitchLogin); if (!channel) continue;
    channels.set(channel, { channel, tenantId: resolveTwitchMtFixItTenantId(undefined, data.twitchId) });
  }
  return [...channels.values()];
}

async function getValidBotCredentials(): Promise<{ username: string; accessToken: string } | null> {
  const ref = db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth'); const snapshot = await ref.get(); if (!snapshot.exists) return null;
  const data = snapshot.data() || {}; const username = String(data.botUsername || '').trim(); const accessToken = String(data.accessToken || '').trim();
  const refreshToken = String(data.refreshToken || data.refresh_token || '').trim(); const expiresAt = Number(data.expiresAt || 0);
  if (username && accessToken && Date.now() < expiresAt - 5 * 60_000) return { username, accessToken };
  if (!username || !refreshToken || !twitchClientId || !process.env.TWITCH_CLIENT_SECRET) return null;
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: twitchClientId, client_secret: process.env.TWITCH_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken }), signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) { console.error(`[MtFixIt:Twitch] Bot token refresh failed status=${response.status} payload=${JSON.stringify(payload)}`); return null; }
  const updated = { accessToken: String(payload.access_token), refreshToken: String(payload.refresh_token || refreshToken), expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000, updatedAt: new Date().toISOString(), refreshErrorCode: null, refreshErrorAt: null, lastRefreshError: null };
  await ref.set(updated, { merge: true }); return { username, accessToken: updated.accessToken };
}

async function syncChannels(client: tmi.Client, joined: Set<string>, retries: Map<string, RetryState>, tenantByChannel: Map<string, string>) {
  const liveChannels = await getLiveChannels(); const live = new Set(liveChannels.map((entry) => entry.channel)); tenantByChannel.clear();
  for (const entry of liveChannels) if (entry.tenantId) tenantByChannel.set(entry.channel, entry.tenantId);
  for (const channel of [...retries.keys()]) if (!live.has(channel)) retries.delete(channel);
  for (const channel of live) {
    if (joined.has(channel)) { retries.delete(channel); continue; }
    const retry = retries.get(channel); if (retry && retry.nextAt > Date.now()) continue;
    try { await client.join(channel); joined.add(channel); retries.delete(channel); console.log(`[MtFixIt:Twitch] Joined #${channel}`); }
    catch (error) { const delay = scheduleRetry(retries, channel); console.warn(`[MtFixIt:Twitch] Join #${channel} deferred for ${Math.round(delay / 1000)}s: ${errorText(error)}`); }
  }
  for (const channel of [...joined]) {
    if (live.has(channel)) continue;
    try { await client.part(channel); } catch (error) { console.warn(`[MtFixIt:Twitch] Part #${channel} did not confirm: ${errorText(error)}`); }
    finally { joined.delete(channel); retries.delete(channel); tenantByChannel.delete(channel); }
    console.log(`[MtFixIt:Twitch] Parted #${channel}`);
  }
}

async function runWatcher() {
  if (!serverId) throw new Error('DSH guild/server ID is not configured.');
  const credentials = await getValidBotCredentials();
  if (!credentials) { console.warn('[MtFixIt:Twitch] Bot OAuth is unavailable; retrying later.'); setTimeout(() => runWatcher().catch(console.error), TOKEN_RETRY_MS).unref?.(); return; }
  const initialChannels = await getLiveChannels(); const joined = new Set<string>(); const retries = new Map<string, RetryState>();
  const tenantByChannel = new Map<string, string>(initialChannels.filter((entry) => entry.tenantId).map((entry) => [entry.channel, entry.tenantId as string]));
  const client = new tmi.Client({ options: { debug: false }, identity: { username: credentials.username, password: `oauth:${credentials.accessToken}` }, channels: initialChannels.map((entry) => entry.channel).filter(Boolean) });

  client.on('message', async (channel, tags, message, self) => {
    if (self) return; const description = parseMtFixItCommand(message); if (description === null) return; const targetChannel = normalizeChannel(channel);
    if (!description) { await client.say(`#${targetChannel}`, mtFixItPublicReply('usage')).catch(console.error); return; }
    const reporterId = String(tags['user-id'] || '').trim(); const reporter = String(tags['display-name'] || tags.username || 'Twitch user').trim(); if (!reporterId) return;
    const tenantId = resolveTwitchMtFixItTenantId(tags['room-id'], tenantByChannel.get(targetChannel));
    try {
      const submission = await submitMtFixItOrchestrated({ source: 'twitch', reporter, reporterId, description, tenantId, guildId: serverId, channelId: targetChannel, channelName: targetChannel, messageId: String(tags.id || '').trim() || undefined }, {
        onLifecycle: async (event) => {
          await recordMtFixItOutcome(event.jobId, event.outcome);
          await client.say(`#${targetChannel}`, mtFixItPublicReply(event.outcome));
        },
      });
      if (submission.disposition === 'submitted') await registerMtFixItDelivery({ jobId: submission.jobId, source: 'twitch', reporter, description, channelId: targetChannel, guildId: serverId });
      const outcome = submission.disposition === 'submitted' ? 'accepted' : 'failed';
      await client.say(`#${targetChannel}`, mtFixItPublicReply(outcome));
      if (outcome === 'failed') await recordMtFixItOutcome(submission.jobId, 'failed');
    } catch (error) {
      console.error('[MtFixIt:Twitch] Submission handler failed:', errorText(error));
      await client.say(`#${targetChannel}`, mtFixItPublicReply('failed')).catch(console.error);
    }
  });

  client.on('join', (channel) => { const normalized = normalizeChannel(channel); joined.add(normalized); retries.delete(normalized); });
  client.on('part', (channel) => joined.delete(normalizeChannel(channel)));
  client.on('disconnected', (reason) => { console.warn(`[MtFixIt:Twitch] Disconnected: ${reason}`); setTimeout(() => runWatcher().catch(console.error), TOKEN_RETRY_MS).unref?.(); });
  await client.connect();
  for (const channel of client.getChannels()) joined.add(normalizeChannel(channel));
  console.log(`[MtFixIt:Twitch] Connected as ${credentials.username}; watching ${joined.size} live channel(s).`);
  await resumePendingMtFixItDeliveries('twitch', async (record, outcome) => {
    const channel = normalizeChannel(record.channelId);
    if (!joined.has(channel)) await client.join(channel).catch(() => undefined);
    await client.say(`#${channel}`, mtFixItPublicReply(outcome));
  }).then((count) => { if (count) console.log(`[MtFixIt:Twitch] Resumed ${count} pending MtFixIt delivery record(s).`); });
  const timer = setInterval(() => syncChannels(client, joined, retries, tenantByChannel).catch((error) => console.warn('[MtFixIt:Twitch] Channel list refresh deferred:', errorText(error))), CHANNEL_REFRESH_MS); timer.unref?.();
}

runWatcher().catch((error) => {
  console.error('[MtFixIt:Twitch] Fatal startup error:', error);
  setTimeout(() => runWatcher().catch(console.error), TOKEN_RETRY_MS).unref?.();
});
