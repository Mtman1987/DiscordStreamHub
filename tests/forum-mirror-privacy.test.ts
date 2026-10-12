import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { isPublicMirrorSource } from '../src/lib/discord-mirror-privacy';
import { ensureMirrorThread, removeRestrictedMirror, ForumDiscordError, rulePath, type ForumRule } from '../src/lib/discord-forum-mirror';
import { sqliteService } from '../src/lib/sqlite-service';
import { POST } from '../src/app/api/discord/forward-to-forum/route';
const source = '110000000000000001', channelId = '440000000000000001';
const guild = { id: source, roles: [{ id: source, permissions: '1024' }, { id: 'bot-admin', permissions: '8' }] };
const channel = { id: channelId, guild_id: source, name: 'mod-only', type: 0, permission_overwrites: [] as any[] };
const rule: ForumRule = { sourceServerId: source, destinationServerId: '220000000000000001', forumChannelId: '330000000000000001' };
test('public visibility uses everyone permissions; bot Administrator never grants publication', () => {
  assert.equal(isPublicMirrorSource(guild, channel), true);
  assert.equal(isPublicMirrorSource(guild, { ...channel, permission_overwrites: [{ id: source, type: 0, deny: '1024', allow: '0' }, { id: 'bot-admin', type: 0, allow: '1024', deny: '0' }] }), false);
  assert.equal(isPublicMirrorSource({ ...guild, roles: [{ id: source, permissions: '0' }] }, channel), false);
  for (const type of [0, 1]) assert.equal(isPublicMirrorSource(guild, { ...channel, permission_overwrites: [{ id: 'restricted', type, deny: '1024', allow: '0' }] }), false);
  assert.equal(isPublicMirrorSource({ ...guild, roles: [{ id: source, permissions: '0' }] }, { ...channel, permission_overwrites: [{ id: source, type: 0, allow: '1024', deny: '0' }] }), true);
  assert.equal(isPublicMirrorSource(guild, { ...channel, permission_overwrites: undefined }), false);
  assert.equal(isPublicMirrorSource(guild, { ...channel, guild_id: 'other' }), false);
  for (const type of [4, 12, 15, 16]) assert.equal(isPublicMirrorSource(guild, { ...channel, type }), false);
});
test('setup cannot create restricted mirrors in either per-channel or shared-thread mode', async () => {
  sqliteService.setDoc(rulePath(source), rule);
  const writes: string[] = [];
  const api = async (path: string, init?: RequestInit) => {
    if (init?.method) writes.push(path);
    if (path === '/guilds/' + source) return guild;
    if (path === '/channels/' + channelId) return { ...channel, permission_overwrites: [{ id: source, type: 0, deny: '1024', allow: '0' }] };
    throw new Error('Unexpected ' + path);
  };
  for (const forwardingMode of ['per-source-thread', 'single-thread']) {
    await assert.rejects(ensureMirrorThread({ ...rule, forwardingMode, sharedThreadId: 'shared' }, channel, api), /Restricted/);
  }
  assert.deepEqual(writes, []);
});
test('private messages and threads cannot enter Discord or either website feed; live permission changes are honored', async () => {
  const originalFetch = globalThis.fetch, originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'mock-only';
  sqliteService.setDoc(rulePath(source), rule);
  let privateThread = false, deny = true, permissionUnavailable = false;
  const writes: string[] = [];
  globalThis.fetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input)), path = url.pathname.replace('/api/v10', '');
    if (init.method && init.method !== 'GET') { writes.push(String(input)); throw new Error('Unexpected write'); }
    if (path === '/guilds/' + source) {
      if (permissionUnavailable) return new Response('{}', { status: 503 });
      return Response.json(guild);
    }
    if (path === '/channels/' + channelId) return Response.json({ ...channel, permission_overwrites: deny ? [{ id: source, type: 0, deny: '1024', allow: '0' }] : [] });
    if (path === '/channels/440000000000000002') return Response.json({ id: '440000000000000002', guild_id: source, type: privateThread ? 12 : 11, parent_id: channelId });
    throw new Error('Unexpected ' + path);
  };
  const request = (id: string) => new NextRequest('https://dsh.test/api/discord/forward-to-forum', {
    method: 'POST', headers: { 'x-discord-bot-token': 'mock-only' },
    body: JSON.stringify({ guildId: source, channelId: id, messageId: 'unique-message', message: 'private payload' }),
  });
  try {
    for (const id of [channelId, '440000000000000002']) {
      const res = await POST(request(id)); assert.equal(res.status, 200); assert.equal((await res.json()).skipped, 'restricted-source-channel');
    }
    deny = false; privateThread = true;
    const privateRes = await POST(request('440000000000000002')); assert.equal((await privateRes.json()).skipped, 'private-source-thread');
    // A later permission restriction must not reuse cached public access.
    deny = true;
    assert.equal((await (await POST(request(channelId))).json()).skipped, 'restricted-source-channel');
    permissionUnavailable = true;
    assert.equal((await POST(request(channelId))).status, 500);
    assert.deepEqual(writes, []);
  } finally { globalThis.fetch = originalFetch; if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = originalToken; }
});

test('privacy cleanup removes mapped copies and history atomically, preserves public siblings and never deletes source channels', async () => {
  const key = source + ':' + channelId;
  const threadId = '550000000000000001';
  sqliteService.setDoc(rulePath(source), { ...rule, mappings: { [key]: threadId, public: 'other-thread' }, labels: { [key]: 'mod', public: 'general' } });
  sqliteService.setDoc('servers/' + source + '/forwardedMessages/private-message', { forwardedMessageId: 'private-message', forwardedThreadId: threadId, originSourceChannelId: channelId, destinationServerId: rule.destinationServerId });
  const writes: string[] = [];
  await removeRestrictedMirror(rule, channelId, async (path, init) => {
    assert.equal(path, '/channels/' + threadId);
    if (init?.method === 'DELETE') { writes.push(path); return null; }
    return { id: threadId, guild_id: rule.destinationServerId, parent_id: rule.forumChannelId, type: 11 };
  });
  assert.deepEqual(writes, ['/channels/' + threadId]);
  assert.deepEqual(sqliteService.getDoc(rulePath(source)).data.mappings, { public: 'other-thread' });
  assert.equal(sqliteService.getDoc('servers/' + source + '/forwardedMessages/private-message').exists, false);
  // Already deleted destinations are safe to clean again.
  sqliteService.setDoc(rulePath(source), { ...rule, mappings: { [key]: threadId } });
  await removeRestrictedMirror(rule, channelId, async () => { throw new ForumDiscordError(404, 10003, 'Unknown Channel'); });
  assert.deepEqual(sqliteService.getDoc(rulePath(source)).data.mappings, {});
  sqliteService.setDoc(rulePath(source), { ...rule, mappings: { [key]: channelId } });
  await assert.rejects(removeRestrictedMirror(rule, channelId, async (_path, init) => {
    if (init?.method) throw new Error('Source deletion attempted');
    return channel;
  }), /unrelated/);
});
