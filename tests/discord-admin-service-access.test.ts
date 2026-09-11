import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server';
import { getDiscordMemberAccess } from '../src/lib/discord-member-access';
import * as secrets from '../src/lib/runtime-secrets';

const owner = '111111111111111111';
const member = '222222222222222222';
const guild = '333333333333333333';
function route() {
  const source = readFileSync('src/app/api/admin/access/route.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  let browserLookups = 0;
  const deps: Record<string, any> = {
    'next/server': { NextResponse },
    '@/lib/spmt-session': { DSH_SPMT_COOKIE: 'dsh_spmt_session', async resolveSpmtSession(token: string) {
      browserLookups++;
      if (token !== 'valid-user') throw new Error('invalid');
      return { session: { isAdmin: true, role: 'owner', discordUserId: owner, discordServerId: guild } };
    } },
    '@/lib/db': { db: { get(collection: string, id: string) {
      if (collection === 'servers') return { ownerId: owner, adminRoles: ['crew-role'] };
      return id === member ? { roles: [] } : null;
    } } },
    '@/lib/runtime-config': { getHardcodedAdminDiscordId: () => owner },
    '@/lib/runtime-secrets': secrets,
    '@/lib/discord-member-access': { getDiscordMemberAccess },
  };
  vm.runInNewContext(compiled, { exports, require(name: string) {
    assert.ok(deps[name], name); return deps[name];
  }, console, process });
  return { post: exports.POST, browserLookups: () => browserLookups };
}
function request(userId: string, token = 'service-test', extra = {}) {
  return new NextRequest('https://dsh.test/api/admin/access', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, serverId: guild, ...extra }),
  });
}
test('service calls resolve owner and member without browser cookies or a userinfo request', async () => {
  const saved = process.env.DSH_SERVICE_SECRET;
  process.env.DSH_SERVICE_SECRET = 'service-test';
  try {
    const handler = route();
    const ownerResponse = await handler.post(request(owner));
    assert.equal(ownerResponse.status, 200);
    assert.equal((await ownerResponse.json()).isOwner, true);
    const memberResponse = await handler.post(request(member, 'service-test', { isOwner: true, isAdmin: true, roles: ['crew-role'] }));
    const data = await memberResponse.json();
    assert.equal(data.isOwner, false);
    assert.equal(data.isAdmin, false);
    assert.equal(handler.browserLookups(), 0);
    assert.equal((await handler.post(request(owner, 'wrong-service'))).status, 401);
    assert.equal((await handler.post(request(owner, 'valid-user'))).status, 200);
    assert.equal((await handler.post(request(member, 'valid-user'))).status, 403);
  } finally { if (saved === undefined) delete process.env.DSH_SERVICE_SECRET; else process.env.DSH_SERVICE_SECRET = saved; }
});
test('configured admin roles and tenant owners retain their existing privileges', () => {
  assert.equal(getDiscordMemberAccess({ userId: member, ownerDiscordId: owner, server: { ownerId: member }, member: {} }).isOwner, true);
  assert.equal(getDiscordMemberAccess({ userId: member, ownerDiscordId: owner, server: { adminRoles: ['Crew'] }, member: { roleNames: ['crew'] } }).isAdmin, true);
  assert.equal(getDiscordMemberAccess({ userId: member, ownerDiscordId: owner, server: { adminRoles: ['Crew'] }, member: {} }).isAdmin, false);
});
test('the Discord voice adapter targets one movie session across different guilds and channels', () => {
  const source = readFileSync('scripts/watch-voice-bot.ts', 'utf8');
  const fn = source.slice(source.indexOf('function sessionIdFor('), source.indexOf('\nasync function createActivityInvite'));
  const compiled = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const getId = vm.runInNewContext(compiled + '\nsessionIdFor');
  assert.equal(getId(guild, owner), 'discord-watch-room');
  assert.equal(getId(member, guild), 'discord-watch-room');
});
