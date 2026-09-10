import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVoidwalkerRole } from '../src/lib/voidwalker-role';

function fixture() {
  const requests: Array<{ path: string; method: string }> = [];
  const held = new Set(['seeker', 'hunter', 'crew']);
  const roles = [{ id: 'title', name: 'Voidwalker' }, { id: 'seeker', name: 'Signal Seeker' }, { id: 'hunter', name: 'Signal Hunter' }, { id: 'crew', name: 'Crew' }];
  let failGrant = false; let failRemove = false;
  const discord = async (path: string, init: RequestInit = {}) => {
    const method = init.method || 'GET'; requests.push({ path, method });
    if (method === 'GET') return path.endsWith('/roles') ? roles : { roles: [...held] };
    const id = path.split('/').at(-1)!;
    if (method === 'PUT') { if (failGrant) throw new Error('Discord 403'); held.add(id); }
    if (method === 'DELETE') { if (failRemove) throw new Error('Discord 429'); held.delete(id); }
    if (method === 'POST') { const created = { id: 'created', name: 'Voidwalker' }; roles.push(created); return created; }
    return null;
  };
  const input = { guildId: '1240832965865635881', discordUserId: '111111111111111111', discord, rememberTitleRole: async () => {} };
  return { input, roles, requests, held, failGrant: (v: boolean) => { failGrant = v; }, failRemove: (v: boolean) => { failRemove = v; } };
}

test('grants Voidwalker before removing both clue roles and preserves unrelated roles', async () => {
  const f = fixture(); await applyVoidwalkerRole(f.input);
  assert.deepEqual([...f.held].sort(), ['crew', 'title']);
  assert.deepEqual(f.requests.filter((r) => r.method !== 'GET').map((r) => r.method), ['PUT', 'DELETE', 'DELETE']);
});
test('failed title grant keeps clue memberships intact', async () => {
  const f = fixture(); f.failGrant(true);
  await assert.rejects(applyVoidwalkerRole(f.input), /403/);
  assert.deepEqual([...f.held].sort(), ['crew', 'hunter', 'seeker']);
  assert.equal(f.requests.some((r) => r.method === 'DELETE'), false);
});
test('retry completes clue removal after a partial failure without creating another role', async () => {
  const f = fixture(); f.failRemove(true);
  await assert.rejects(applyVoidwalkerRole(f.input), /429/);
  assert.equal(f.held.has('title'), true);
  f.failRemove(false);
  await applyVoidwalkerRole(f.input);
  await applyVoidwalkerRole(f.input);
  assert.equal(f.requests.filter((r) => r.method === 'PUT').length, 1);
  assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
  assert.deepEqual([...f.held].sort(), ['crew', 'title']);
});
test('creates an absent title role once and reuses it', async () => {
  const f = fixture(); f.roles.shift();
  await applyVoidwalkerRole(f.input); await applyVoidwalkerRole(f.input);
  assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
  assert.equal(f.held.has('created'), true);
});
test('configured clue role is removed even if renamed, without creating a clue role', async () => {
  const f = fixture(); f.roles.find((r) => r.id === 'seeker')!.name = 'Egg Hunters';
  await applyVoidwalkerRole({ ...f.input, clueRoleId: 'seeker' });
  assert.equal(f.held.has('seeker'), false);
  assert.equal(f.requests.some((r) => r.method === 'POST'), false);
});
test('unverified IDs fail before making Discord calls', async () => {
  const f = fixture();
  await assert.rejects(applyVoidwalkerRole({ ...f.input, discordUserId: 'display-name' }), /verified/);
  assert.equal(f.requests.length, 0);
});
