import assert from 'node:assert/strict';
import test from 'node:test';
import { sqliteService } from '../src/lib/sqlite-service';
import { ensureMirrorThread, ForumDiscordError, mirrorThreadName, syncForumChannels, rulePath, type ForumRule } from '../src/lib/discord-forum-mirror';
import { channelPermissions } from '../src/lib/discord-guild-access';

const rule: ForumRule = { sourceServerId: '110000000000000001', destinationServerId: '220000000000000001', forumChannelId: '330000000000000001', forwardingMode: 'per-source-thread' };
const channel = { id: '440000000000000001', name: 'general' };
function setup() {
  sqliteService.setDoc(rulePath(rule.sourceServerId), rule);
  sqliteService.deleteDoc('servers/' + rule.sourceServerId + '/config/channels');
  for (const row of sqliteService.getCollection('servers/' + rule.sourceServerId + '/forwardedMessages').docs) sqliteService.deleteDoc('servers/' + rule.sourceServerId + '/forwardedMessages/' + row.id);
  for (const id of ['440000000000000001', '440000000000000002']) sqliteService.deleteDoc('forwardingThreadState/' + rule.destinationServerId + ':' + rule.forumChannelId + ':' + rule.sourceServerId + ':' + id);
}
function mock(options: { archived?: boolean; existing?: boolean; failCreate?: boolean; deny?: boolean } = {}) {
  let creates = 0, unarchives = 0;
  const thread = { id: '550000000000000001', guild_id: rule.destinationServerId, parent_id: rule.forumChannelId, type: 11, owner_id: 'bot-test', name: mirrorThreadName(channel.name, rule.sourceServerId, channel.id), thread_metadata: { archived: !!options.archived } };
  const api = async (path: string, init?: RequestInit): Promise<any> => {
    if (path === '/users/@me') return { id: 'bot-test' };
    if (path === '/channels/' + thread.id) {
      if (options.deny) throw new ForumDiscordError(403, 50013, 'Missing Permissions');
      if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); if (body.archived === false) { unarchives++; thread.thread_metadata.archived = false; } if (body.name) thread.name = body.name; }
      return thread;
    }
    if (path === '/channels/' + rule.forumChannelId) return { id: rule.forumChannelId, guild_id: rule.destinationServerId, type: 15 };
    if (path.endsWith('/threads/active')) return { threads: options.existing && !options.archived ? [thread] : [] };
    if (path.includes('/threads/archived/public')) return { threads: options.existing && options.archived ? [thread] : [], has_more: false };
    if (path === '/guilds/' + rule.sourceServerId) return { name: 'Source' };
    if (path === '/guilds/' + rule.sourceServerId + '/channels') return [channel, { id: '440000000000000002', name: 'quiet', type: 0 }, { id: '440000000000000003', name: 'category', type: 4 }, { id: '440000000000000004', name: 'forum', type: 15 }, { id: '440000000000000005', name: 'media', type: 16 }].map(c => ({ type: 0, ...c }));
    if (path.endsWith('/threads') && init?.method === 'POST') {
      creates++;
      if (options.failCreate) throw new Error('Connection lost after Discord accepted create');
      await new Promise(resolve => setTimeout(resolve, 20));
      return thread;
    }
    throw new Error('Unexpected ' + path);
  };
  return { api, counts: () => ({ creates, unarchives }) };
}
test('nested map updates retain sibling channels, even when settings sends an empty map', () => {
  setup();
  sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { one: 'thread1' } });
  sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { two: 'thread2' } });
  sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: {} }, { ruleLabel: 'edited' });
  assert.deepEqual(sqliteService.getDoc(rulePath(rule.sourceServerId)).data.mappings, { one: 'thread1', two: 'thread2' });
});
test('simultaneous first messages create exactly one thread; restart state reuses it', async () => {
  setup(); const m = mock();
  const results = await Promise.all([ensureMirrorThread(rule, channel, m.api), ensureMirrorThread(rule, channel, m.api)]);
  assert.equal(m.counts().creates, 1);
  assert.equal(results[0].threadId, results[1].threadId);
  await ensureMirrorThread(rule, channel, m.api);
  assert.equal(m.counts().creates, 1);
});
test('lost mapping recovers an archived thread and reads thread_metadata correctly', async () => {
  setup(); const m = mock({ archived: true, existing: true });
  const result = await ensureMirrorThread(rule, channel, m.api);
  assert.equal(result.created, false);
  assert.deepEqual(m.counts(), { creates: 0, unarchives: 1 });
});
test('temporary/permission errors on mapped thread do not create replacement', async () => {
  setup(); sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { [rule.sourceServerId + ':' + channel.id]: '550000000000000001' } });
  const m = mock({ deny: true });
  await assert.rejects(ensureMirrorThread(rule, channel, m.api), /Missing Permissions/);
  assert.equal(m.counts().creates, 0);
});
test('ambiguous create survives restart and refuses duplicate creation', async () => {
  setup(); const m = mock({ failCreate: true });
  await assert.rejects(ensureMirrorThread(rule, channel, m.api), /Connection lost/);
  await assert.rejects(ensureMirrorThread(rule, channel, m.api), /unknown result/);
  assert.equal(m.counts().creates, 1);
  const recovery = mock({ existing: true });
  await ensureMirrorThread(rule, channel, recovery.api);
  assert.equal(recovery.counts().creates, 0);
});
test('setup includes quiet text and voice channels, excluding categories', async () => {
  setup(); const m = mock();
  const result = await syncForumChannels(rule, m.api);
  assert.equal(result.total, 2); assert.equal(result.errors.length, 0); assert.equal(result.created, 2);
});
test('channel overwrite denies cannot be bypassed by a generic moderator role', () => {
  const guild = { id: 'guild', owner_id: 'owner', roles: [{ id: 'guild', permissions: '1024' }, { id: 'mod', permissions: '8192' }] };
  const member = { user: { id: 'user' }, roles: ['mod'] };
  assert.equal(channelPermissions(guild, member, { permission_overwrites: [{ id: 'user', type: 1, deny: '8192', allow: '0' }] }) & BigInt('8192'), BigInt(0));
  assert.equal(channelPermissions(guild, { user: { id: 'owner' } }, {}) & BigInt('8'), BigInt('8'));
});

test('lost map recovers the oldest thread from source-ID message history without creating another duplicate', async () => {
  setup();
  const m = mock();
  const first = { id: '550000000000000001', guild_id: rule.destinationServerId, parent_id: rule.forumChannelId, type: 11, name: 'old-name', thread_metadata: { archived: false } };
  const newer = { ...first, id: '550000000000000002' };
  for (const thread of [first, newer]) sqliteService.setDoc('servers/' + rule.sourceServerId + '/forwardedMessages/' + thread.id, {
    forwardedThreadId: thread.id, originSourceChannelId: channel.id, destinationServerId: rule.destinationServerId,
  });
  const api = async (path: string, options?: RequestInit) => {
    if (path.endsWith('/threads/active')) return { threads: [newer, first] };
    if (path === '/channels/' + first.id) return first;
    if (path === '/channels/' + newer.id && options?.method === 'DELETE') return null;
    return m.api(path, options);
  };
  const result = await ensureMirrorThread(rule, channel, api);
  assert.equal(result.threadId, first.id);
  assert.equal(m.counts().creates, 0);
});

test('thread titles contain the channel name and no visible server/channel IDs', () => {
  assert.equal(mirrorThreadName('🚀｜allied-launch', rule.sourceServerId, channel.id), '🚀｜allied-launch');
  assert.ok(!mirrorThreadName('general', rule.sourceServerId, channel.id).includes(rule.sourceServerId));
});
test('forum/media sources are excluded before any Discord write', async () => {
  setup(); let called = false;
  for (const type of [15, 16]) await assert.rejects(ensureMirrorThread(rule, { ...channel, type }, async () => { called = true; }), /excluded/);
  assert.equal(called, false);
});
test('a confirmed deleted mapped thread is replaced, while the deleted predecessor cannot remain as a copy', async () => {
  setup(); const missingId = '990000000000000001';
  sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { [rule.sourceServerId + ':' + channel.id]: missingId } });
  const m = mock();
  const api = async (path: string, options?: RequestInit) => {
    if (path === '/channels/' + missingId) throw new ForumDiscordError(404, 10003, 'Unknown Channel');
    return m.api(path, options);
  };
  const result = await ensureMirrorThread(rule, channel, api);
  assert.equal(result.created, true); assert.equal(m.counts().creates, 1);
  assert.notEqual(result.threadId, missingId);
});
test('duplicate deletion failure stops forwarding rather than leaving copies or creating another', async () => {
  setup(); const m = mock({ existing: true });
  const second = { id: '550000000000000002', name: 'general', owner_id: 'bot-test', parent_id: rule.forumChannelId, guild_id: rule.destinationServerId, type: 11 };
  const api = async (path: string, options?: RequestInit) => {
    if (path.endsWith('/threads/active')) return { threads: [{ ...second, id: '550000000000000001' }, second] };
    if (path === '/channels/' + second.id && options?.method === 'DELETE') throw new ForumDiscordError(403, 50013, 'Cannot delete duplicate');
    return m.api(path, options);
  };
  await assert.rejects(ensureMirrorThread(rule, channel, api), /Cannot delete duplicate/);
  assert.equal(m.counts().creates, 0);
});

test('an in-flight old-destination operation cannot restore its mappings after a forum reset', () => {
  setup();
  sqliteService.setDoc(rulePath(rule.sourceServerId), { ...rule, forumChannelId: 'a-new-destination', mappings: {} });
  assert.throws(() => sqliteService.mergeDocMaps(rulePath(rule.sourceServerId), { mappings: { old: 'old-thread' } }, {}, { forumChannelId: rule.forumChannelId }), /configuration changed/);
  assert.deepEqual(sqliteService.getDoc(rulePath(rule.sourceServerId)).data.mappings, {});
});
