import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as hunt from '../src/lib/signal-hunt';

function load(file: string, imports: Record<string, unknown>, globals: Record<string, unknown>) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; }, console, Date, AbortSignal, ...globals }, { filename: file });
  return exports;
}
function fixture() {
  const records = new Map<string, any>();
  const db: any = { collection: (path: string) => ({ doc: (id: string) => ({
    collection: (name: string) => db.collection(`${path}/${id}/${name}`),
    get: async () => ({ exists: records.has(`${path}/${id}`), data: () => records.get(`${path}/${id}`) }),
    set: async (data: any, options?: any) => { const key = `${path}/${id}`; records.set(key, { ...(options?.merge ? records.get(key) : {}), ...data }); },
  }) }) };
  const calls: any[] = [];
  let failAlert = false;
  let failDelete = false;
  let destinationGuild = 'guild';
  const fetcher = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method || 'GET', body });
    if (!init.method) return { ok: true, json: async () => ({ guild_id: destinationGuild }) };
    const isAlert = url.endsWith('/nebula/messages');
    const failed = (isAlert && failAlert) || (init.method === 'DELETE' && failDelete);
    return { ok: !failed, status: failed ? 503 : 200, json: async () => failed ? {} : { id: isAlert ? 'notice' : 'source' } };
  };
  const process = { env: { DISCORD_BOT_TOKEN: 'fixture-token' } };
  const cleanup = load('src/lib/signal-drop-cleanup.ts', { './db': { db }, './signal-hunt': hunt }, { fetch: fetcher, process });
  const scheduled: number[] = [];
  const route = load('src/app/api/internal/signal/drop/route.ts', {
    'node:crypto': { randomUUID: () => 'drop' },
    'next/server': { NextResponse: { json: (body: any, options: any = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/db': { db },
    '@/lib/runtime-secrets': { getServiceToServiceSecrets: () => [], hasAuthorizedBearerToken: (token: string) => token === 'authorized' },
    '@/lib/signal-seeker-service': { ensureSignalSeekerRole: async () => 'hunters' },
    '@/lib/runtime-config': { getChatTagChannelId: () => 'nebula', getHardcodedGuildId: () => 'guild' },
    '@/lib/signal-hunt': hunt,
    '@/lib/signal-drop-cleanup': { ...cleanup, startSignalDropCleanup: () => {} },
  }, { fetch: fetcher, process, setTimeout: (_fn: unknown, ms: number) => { scheduled.push(ms); return { unref() {} }; } });
  const post = (auth = 'authorized') => route.POST({ headers: { get: () => auth }, json: async () => ({ guildId: 'guild', channelId: 'lounge', channelName: 'lounge', clue: 'A transmission', botName: 'Test' }) });
  return { records, calls, post, scheduled, cleanup, failAlert: () => { failAlert = true; }, failDelete: (value: boolean) => { failDelete = value; }, wrongGuild: () => { destinationGuild = 'other'; } };
}

test('real drop route preserves source role mention silently and sends one new alert', async () => {
  const f = fixture();
  const response = await f.post();
  assert.equal(response.status, 200);
  const sends = f.calls.filter(c => c.method === 'POST');
  assert.equal(sends.length, 2);
  assert.equal(sends[0].body.flags, 4096);
  assert.match(sends[0].body.content, /<@&hunters>/);
  assert.deepEqual(sends[0].body.allowed_mentions.roles, ['hunters']);
  assert.equal(sends[1].body.flags, undefined);
  assert.match(sends[1].body.embeds[0].description, /guild\/lounge\/source/);
  assert.equal(f.records.get('signalDrops/drop').alertMessageId, 'notice');
  assert.deepEqual(f.scheduled, [3_600_000]);
});
test('unauthorized calls and a wrong-server alert destination never post', async () => {
  const f = fixture();
  assert.equal((await f.post('wrong')).status, 401);
  assert.equal(f.calls.length, 0);
  f.wrongGuild();
  assert.equal((await f.post()).status, 503);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
});
test('an alert failure leaves one usable source without asking the scheduler to duplicate it', async () => {
  const f = fixture(); f.failAlert();
  assert.equal((await f.post()).status, 200);
  assert.equal(f.records.get('signalDrops/drop').status, 'active');
});
test('expiry retains the live hour, then removes source and marks notice ended; failures remain retryable', async () => {
  const f = fixture(); await f.post();
  await f.cleanup.expireSignalDrop('drop');
  assert.equal(f.calls.some(c => c.method === 'DELETE'), false);
  f.records.get('signalDrops/drop').expiresAt = new Date(Date.now() - 1).toISOString();
  f.failDelete(true);
  await assert.rejects(f.cleanup.expireSignalDrop('drop'));
  assert.equal(f.records.get('signalDrops/drop').status, 'active');
  f.failDelete(false);
  await f.cleanup.expireSignalDrop('drop');
  assert.equal(f.records.get('signalDrops/drop').status, 'expired');
  const edit = f.calls.find(c => c.method === 'PATCH');
  assert.equal(edit.body.embeds[0].title, '📡 SIGNAL ENDED');
  assert.deepEqual(edit.body.allowed_mentions.parse, []);
  const count = f.calls.length;
  await f.cleanup.expireSignalDrop('drop');
  assert.equal(f.calls.length, count);
});
