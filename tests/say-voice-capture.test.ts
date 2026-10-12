import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { discordPcmToWav, SAY_VOICE_MAX_MS } from '../src/lib/say-voice-pcm';
import { handleSayVoice } from '../scripts/say-voice-listener';

const userId = '767875979561009173';
function fixture(existing = false, differentChannel = false) {
  const opus = new PassThrough(); let selected = ''; let destroyed = 0; const rejoins: any[] = [];
  const state: any = { channelId: '1240832965865635882', channel: { name: 'VC' }, selfMute: false, guild: { id: String(Math.floor(Math.random() * 1e12)), voiceStates: { cache: new Map() }, voiceAdapterCreator: {} } };
  state.guild.voiceStates.cache.set(userId, state);
  const connection: any = { joinConfig: { channelId: differentChannel ? 'other' : state.channelId, selfDeaf: existing, selfMute: false }, state: { status: 'ready' }, destroy() { destroyed++; }, rejoin(config: any) { rejoins.push(config); }, receiver: { subscriptions: new Map(), subscribe(id: string) { selected = id; return opus; } } };
  class Decoder extends PassThrough { constructor(_options: any) { super(); } }
  const transport: any = { getVoiceConnection: () => existing ? connection : undefined, joinVoiceChannel: () => connection, entersState: async () => {}, Decoder };
  const client: any = { isReady: () => true, guilds: { cache: new Map([[state.guild.id, state.guild]]) } };
  return { client, state, transport, opus, connection, rejoins, selected: () => selected, destroyed: () => destroyed };
}
test('Discord PCM resamples stereo into bounded mono 16k WAV', () => {
  const pcm = Buffer.alloc(48000 * 4 * SAY_VOICE_MAX_MS / 1000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1200, i);
  const wav = discordPcmToWav(pcm);
  assert.equal(wav.length, 480044); assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readInt16LE(44), 1200);
});
test('probe outside VC opens no listener; invalid identity is rejected', async () => {
  const f = fixture(); f.state.guild.voiceStates.cache.clear();
  assert.deepEqual(await handleSayVoice(f.client, { userId, action: 'probe' }, f.transport), { inVoice: false });
  assert.equal(f.selected(), '');
  await assert.rejects(handleSayVoice(f.client, { userId: 'wrong', action: 'start' }, f.transport), /verified/);
});
test('captures only requesting speaker, caps memory, isolates job ownership and cleans connection', async () => {
  const f = fixture();
  const job = await handleSayVoice(f.client, { userId, action: 'start' }, f.transport);
  assert.equal(f.selected(), userId); assert.equal(job.status, 'recording');
  await assert.rejects(handleSayVoice(f.client, { userId, action: 'start' }, f.transport), /already/);
  await assert.rejects(handleSayVoice(f.client, { userId: '767875979561009174', action: 'stop', id: job.id }, f.transport), /not found/);
  f.opus.write(Buffer.alloc(48000 * 4 * 16, 1));
  await new Promise(resolve => setImmediate(resolve));
  const result = await handleSayVoice(f.client, { userId, action: 'result', id: job.id }, f.transport);
  assert.equal(result.status, 'complete'); assert.equal(Buffer.from(result.base64Audio!, 'base64').length, 480044); assert.equal(f.destroyed(), 1);
});
test('manual finish keeps partial audio and restores existing bot deaf state without disconnecting playback', async () => {
  const f = fixture(true);
  const job = await handleSayVoice(f.client, { userId, action: 'start' }, f.transport);
  f.opus.write(Buffer.alloc(48000 * 4, 1)); await new Promise(resolve => setImmediate(resolve));
  const result = await handleSayVoice(f.client, { userId, action: 'stop', id: job.id }, f.transport);
  assert.equal(result.status, 'complete'); assert.equal(f.destroyed(), 0); assert.equal(f.rejoins.at(-1).selfDeaf, true);
});
test('muted voice and occupied bot channel fail clearly; empty capture and cancel never produce audio', async () => {
  const muted = fixture(); muted.state.selfMute = true;
  await assert.rejects(handleSayVoice(muted.client, { userId, action: 'start' }, muted.transport), /Unmute/);
  const occupied = fixture(true, true);
  await assert.rejects(handleSayVoice(occupied.client, { userId, action: 'start' }, occupied.transport), /not move/);
  assert.equal(occupied.destroyed(), 0);
  const f = fixture(); const job = await handleSayVoice(f.client, { userId, action: 'start' }, f.transport);
  const result = await handleSayVoice(f.client, { userId, action: 'stop', id: job.id }, f.transport);
  assert.equal(result.status, 'error'); assert.equal(result.base64Audio, undefined);
  const c = fixture(); const cancelled = await handleSayVoice(c.client, { userId, action: 'start' }, c.transport);
  const end = await handleSayVoice(c.client, { userId, action: 'cancel', id: cancelled.id }, c.transport);
  assert.equal(end.status, 'cancelled'); assert.equal(end.base64Audio, undefined); assert.equal(c.destroyed(), 1);
});

test('a bridge enabled during capture keeps receiving when the capture finishes', async () => {
  const f = fixture(true);
  let bridgeActive = false;
  const job = await handleSayVoice(f.client, { userId, action: 'start' }, f.transport, () => bridgeActive);
  bridgeActive = true;
  await handleSayVoice(f.client, { userId, action: 'cancel', id: job.id }, f.transport);
  assert.equal(f.rejoins.length, 1);
  assert.equal(f.rejoins[0].selfDeaf, false);
  assert.equal(f.destroyed(), 0);
});
