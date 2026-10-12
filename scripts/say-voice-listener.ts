import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Client } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus, EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { discordPcmToWav, SAY_VOICE_MAX_MS } from '../src/lib/say-voice-pcm';

type Job = { id: string; userId: string; guildId: string; channelId: string; status: string; error?: string; base64Audio?: string; finish: (cancel?: boolean) => void; expiresAt: number };
const jobs = new Map<string, Job>();
const guildLocks = new Set<string>();
const startingUsers = new Set<string>();
const MAX_BYTES = 48000 * 2 * 2 * SAY_VOICE_MAX_MS / 1000;
export async function handleSayVoice(client: Client, body: any, transport = { getVoiceConnection, joinVoiceChannel, entersState, Decoder: prism.opus.Decoder }, receivingActive: (guildId: string) => boolean = () => false) {
  const userId = String(body.userId || '');
  if (!/^\d{16,22}$/.test(userId)) throw new Error('A verified Discord user is required.');
  if (body.action !== 'probe' && body.action !== 'start') {
    const job = jobs.get(String(body.id || ''));
    if (!job || job.userId !== userId) throw new Error('Voice capture not found.');
    if (body.action === 'stop') job.finish();
    else if (body.action === 'cancel') job.finish(true);
    else if (body.action !== 'result') throw new Error('Invalid voice action.');
    return { id: job.id, status: job.status, error: job.error, base64Audio: job.base64Audio };
  }
  if (!client.isReady()) throw new Error('Discord voice listener is reconnecting. Try again shortly.');
  const states = [...client.guilds.cache.values()].flatMap(g => {
    const state = g.voiceStates.cache.get(userId);
    return state?.channelId ? [state] : [];
  });
  if (states.length > 1) throw new Error('Multiple Discord voice channels were found. Leave the extra connection first.');
  const state = states[0];
  if (!state?.channelId) return { inVoice: false };
  if (body.action === 'probe') return { inVoice: true, channelName: state.channel?.name || '', guildId: state.guild.id, channelId: state.channelId };
  if (state.selfMute || state.serverMute || state.suppress) throw new Error('Unmute in Discord so the listener can hear your voice.');
  if (startingUsers.has(userId) || guildLocks.has(state.guild.id)) throw new Error('A voice capture is already running in this server. Try again when it finishes.');
  startingUsers.add(userId); guildLocks.add(state.guild.id);
  let connection = transport.getVoiceConnection(state.guild.id);
  const ownsConnection = !connection;
  const restoreDeaf = connection?.joinConfig.selfDeaf === true;
  let opus: any, decoder: any, timer: ReturnType<typeof setTimeout> | undefined, silence: ReturnType<typeof setTimeout> | undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  let job: Job | undefined;
  const cleanup = () => {
    clearTimeout(timer); clearTimeout(silence);
    try { opus?.unpipe(decoder); opus?.destroy(); decoder?.destroy(); } catch {}
    if (ownsConnection) connection?.destroy();
    else if (restoreDeaf && !receivingActive(state.guild.id) && connection?.state.status !== VoiceConnectionStatus.Destroyed) connection?.rejoin({ ...connection.joinConfig, selfDeaf: true });
    startingUsers.delete(userId); guildLocks.delete(state.guild.id);
  };
  try {
    if (connection && connection.joinConfig.channelId !== state.channelId) throw new Error('The bot is already using another voice channel in this server. It will not move or interrupt that session.');
    if (!connection) connection = transport.joinVoiceChannel({ guildId: state.guild.id, channelId: state.channelId, adapterCreator: state.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
    else if (restoreDeaf) connection.rejoin({ ...connection.joinConfig, selfDeaf: false });
    await transport.entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    if (state.guild.voiceStates.cache.get(userId)?.channelId !== state.channelId) throw new Error('You left Discord voice before recording started.');
    if (connection.receiver.subscriptions.has(userId)) throw new Error('Your voice is already being relayed. Stop that relay before using this independent listener.');
    const finish = (cancel = false) => {
      if (!job || job.status !== 'recording') return;
      job.status = cancel ? 'cancelled' : 'complete';
      cleanup();
      if (cancel) job.error = 'Voice capture cancelled.';
      else if (size < 48000 * 4 / 4) { job.status = 'error'; job.error = 'No Discord voice audio arrived. Check Discord mute and push-to-talk.'; }
      else job.base64Audio = discordPcmToWav(Buffer.concat(chunks, size)).toString('base64');
      chunks.length = 0;
    };
    job = { id: randomUUID(), userId, guildId: state.guild.id, channelId: state.channelId, status: 'recording', finish, expiresAt: Date.now() + 90_000 };
    jobs.set(job.id, job);
    opus = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
    decoder = new transport.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    decoder.on('data', (chunk: Buffer) => {
      if (job?.status !== 'recording') return;
      if (state.guild.voiceStates.cache.get(userId)?.channelId !== job.channelId) { job.error = 'You left the voice channel.'; job.status = 'error'; cleanup(); return; }
      const accepted = Buffer.from(chunk.subarray(0, Math.max(0, MAX_BYTES - size)));
      if (accepted.length) { chunks.push(accepted); size += accepted.length; }
      clearTimeout(silence); silence = setTimeout(() => finish(), 1500);
      if (size >= MAX_BYTES) finish();
    });
    const fail = () => { if (job?.status === 'recording') { job.status = 'error'; job.error = 'Discord voice reception failed. Try again.'; cleanup(); } };
    opus.on('error', fail); decoder.on('error', fail);
    opus.pipe(decoder);
    timer = setTimeout(() => finish(), SAY_VOICE_MAX_MS);
    return { inVoice: true, id: job.id, status: job.status, channelName: state.channel?.name || '' };
  } catch (error) { if (job) { job.status = 'error'; job.error = error instanceof Error ? error.message : 'Voice reception failed.'; } cleanup(); throw error; }
}

export function startSayVoiceServer(client: Client, receivingActive: (guildId: string) => boolean = () => false) {
  // Loopback-only internal transport; the public Next route authenticates service requests.
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || req.url !== '/say') { res.writeHead(404); res.end('{}'); return; }
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk.toString(); if (raw.length > 4096) throw new Error('Request too large.'); }
      res.end(JSON.stringify(await handleSayVoice(client, JSON.parse(raw), undefined, receivingActive)));
    } catch (error) { res.writeHead(409); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Voice listener failed.' })); }
  });
  server.listen(3091, '127.0.0.1');
  const sweep = setInterval(() => { for (const [id, job] of jobs) if (job.expiresAt < Date.now()) { job.finish(true); jobs.delete(id); } }, 30_000);
  sweep.unref();
  server.on('error', error => console.error('[SayVoice] Listener control failed:', error.message));
  return server;
}
