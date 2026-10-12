import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { runCleanupBatch, cleanupJob, enqueueCleanup } from '../src/lib/discord-channel-cleanup';
import { sqliteService } from '../src/lib/sqlite-service';
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
  const response = await POST(request('bot')); const accepted = await response.json();
  assert.equal(response.status, 202); const job = await runCleanupBatch(accepted.jobId); const data = { ...job, success: job?.status === 'completed' }; assert.equal(data.success, true); assert.equal(data.deleted, 1);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path.endsWith(recent)));
  assert.ok(!calls.some(c => c.method === 'DELETE' && c.path.endsWith(old)));
}));
test('all mode individually deletes old messages outside the bulk window', async () => fixture(async calls => {
  const accepted = await (await POST(request('all'))).json(); const data = (await runCleanupBatch(accepted.jobId))!;
  assert.equal(data.deleted, 2);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path.endsWith(old)));
}));
test('until mode keeps the boundary and older messages', async () => fixture(async calls => {
  const accepted = await (await POST(request('until', { untilMessageId: boundary }))).json(); const job = await runCleanupBatch(accepted.jobId); const data = { ...job, success: job?.status === 'completed' };
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
  const accepted = await (await POST(request('bot'))).json(); const job = await runCleanupBatch(accepted.jobId);
  assert.equal(job?.status, 'failed'); assert.match(job?.error || '', /Discord 403/);
}, { failDelete: true }));

test('POST only queues cleanup and returns before any deletion or full history request', async () => fixture(async calls => {
  const response = await POST(request('all')); const data = await response.json();
  assert.equal(response.status, 202); assert.equal(data.job.status, 'queued');
  assert.ok(!calls.some(call => call.method === 'DELETE' || call.path.includes('/messages?')));
  // Mark this isolated scheduling-test job finished so the next test can use the channel.
  sqliteService.setDoc('discordCleanupJobs/' + data.jobId, { ...data.job, status: 'completed' });
}));
test('durable pending message IDs resume after restart; unknown delete responses are retried safely', async () => {
  const input = { ownerAccountId: 'resume-test', discordUserId: userId, guildId, channelId: '990000000000000099', channelName: 'test', mode: 'all' as const, untilMessageId: '', botId: 'bot' };
  const job = enqueueCleanup(input);
  let historyReads = 0, attempts = 0;
  const api = async (path: string, init?: RequestInit): Promise<any> => {
    if (path === '/guilds/' + guildId) return { id: guildId, owner_id: userId, roles: [] };
    if (path.includes('/members/')) return { user: { id: userId }, roles: [] };
    if (path === '/channels/' + input.channelId) return { guild_id: guildId, type: 0 };
    if (path.includes('/messages?')) { historyReads++; return [{ id: old }]; }
    if (init?.method === 'DELETE') { attempts++; if (attempts === 1) throw new Error('socket reset after remote deletion'); return null; }
    throw new Error(path);
  };
  const interrupted = await runCleanupBatch(job.id, api);
  assert.equal(interrupted?.status, 'queued');
  assert.deepEqual(cleanupJob(job.id)?.pendingIds, [old]);
  sqliteService.setDoc('discordCleanupJobs/' + job.id, { ...cleanupJob(job.id), retryAt: 0 });
  const resumed = await runCleanupBatch(job.id, api);
  assert.equal(resumed?.status, 'completed'); assert.equal(resumed?.deleted, 1);
  assert.equal(historyReads, 1); assert.equal(attempts, 2);
});
