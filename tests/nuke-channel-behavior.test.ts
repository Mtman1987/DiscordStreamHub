import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/nuke-channel/route';
const guildId = '110000000000000099', channelId = '220000000000000099', userId = '330000000000000099';
const snowflake = (ago = 0) => ((BigInt(Date.now() - ago - 1420070400000) << BigInt(22)) + BigInt(1)).toString();
const recent = snowflake(), old = snowflake(30 * 86400000), boundary = snowflake(10000);
function request(mode: string, fields = {}) {
  return new NextRequest('https://dsh.test/api/nuke-channel', { method: 'POST',
    headers: { origin: 'https://dsh.test', cookie: 'dsh_spmt_session=test-only', 'content-type': 'application/json' },
    body: JSON.stringify({ guildId, channelId, mode, ...fields }) });
}
async function fixture(run: (calls: Array<{ path: string; method: string; body: any }>) => Promise<void>, options: { deny?: boolean; failDelete?: boolean; messages?: any[] } = {}) {
  const original = globalThis.fetch, token = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'mock-only';
  const calls: Array<{ path: string; method: string; body: any }> = [];
  globalThis.fetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input)), path = url.pathname.replace('/api/v10', '');
    calls.push({ path: path + url.search, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const ok = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (path === '/api/oauth/userinfo') return ok({ id: 'test-manager', discordUserId: userId });
    if (path === '/channels/' + channelId) return ok({ id: channelId, guild_id: guildId, name: 'tenant-general', type: 0,
      permission_overwrites: options.deny ? [{ id: userId, type: 1, deny: '8192', allow: '0' }] : [] });
    if (path === '/guilds/' + guildId) return ok({ id: guildId, owner_id: 'someone-else', roles: [{ id: guildId, permissions: '1024' }, { id: 'moderator', permissions: '8192' }] });
    if (path === '/guilds/' + guildId + '/members/' + userId) return ok({ user: { id: userId }, roles: ['moderator'] });
    if (path === '/users/@me') return ok({ id: 'bot-self' });
    if (init.method === 'DELETE') return options.failDelete ? ok({ message: 'Missing Permissions' }, 403) : new Response(null, { status: 204 });
    if (path.endsWith('/bulk-delete')) return new Response(null, { status: 204 });
    if (path === '/channels/' + channelId + '/messages/' + boundary) return ok({ id: boundary });
    if (path === '/channels/' + channelId + '/messages') return ok(options.messages || [
      { id: recent, author: { id: 'different-bot', bot: true } }, { id: old, author: { id: 'human', bot: false } },
    ]);
    throw new Error('Unexpected test URL ' + url);
  };
  try { await run(calls); } finally { globalThis.fetch = original; if (token === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = token; }
}
test('tenant moderator can nuke bots in their own server, including other bots; humans remain', async () => fixture(async calls => {
  const response = await POST(request('bot')); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.success, true); assert.equal(data.deleted, 1);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path.endsWith(recent)));
  assert.ok(!calls.some(c => c.method === 'DELETE' && c.path.endsWith(old)));
}));
test('all mode individually deletes old messages outside the bulk window', async () => fixture(async calls => {
  const data = await (await POST(request('all'))).json();
  assert.equal(data.deleted, 2);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path.endsWith(old)));
}));
test('until mode keeps the boundary and older messages', async () => fixture(async calls => {
  const data = await (await POST(request('until', { untilMessageId: boundary }))).json();
  assert.equal(data.success, true); assert.equal(data.deleted, 1);
  assert.ok(!calls.some(c => c.method === 'DELETE' && [old, boundary].some(id => c.path.endsWith(id))));
}, { messages: [{ id: recent }, { id: boundary }, { id: old }] }));
test('selected-server mismatch is rejected before any deletion', async () => fixture(async calls => {
  const response = await POST(request('all', { guildId: '999999999999999999' }));
  assert.equal(response.status, 403); assert.ok(!calls.some(c => c.method === 'DELETE'));
}));
test('channel-specific permission denial overrides the moderator role', async () => fixture(async calls => {
  const response = await POST(request('all'));
  assert.equal(response.status, 403); assert.ok(!calls.some(c => c.method === 'DELETE'));
}, { deny: true }));
test('partial failures return a useful error and counts', async () => fixture(async () => {
  const data = await (await POST(request('bot'))).json();
  assert.equal(data.success, false); assert.equal(data.failed, 1); assert.match(data.error, /could not be deleted/);
}, { failDelete: true }));
