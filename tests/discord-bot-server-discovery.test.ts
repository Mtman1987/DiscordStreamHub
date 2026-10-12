import test from 'node:test';
import assert from 'node:assert/strict';
import { botAccountGuilds } from '../src/lib/discord-bot-server-discovery';
import { botInstallUrl } from '../src/lib/discord-server-permissions';

test('bot invite lets Discord choose a server without requesting user guild OAuth', () => {
  const url = new URL(botInstallUrl('1279582181768957963'));
  assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
  assert.equal(url.searchParams.has('response_type'), false);
  assert.equal(url.searchParams.has('redirect_uri'), false);
  assert.equal(url.searchParams.has('disable_guild_select'), false);
});
test('installed servers appear for verified owners and moderators without a user OAuth token', async () => {
  const id = '1136132698746921110';
  const fixture: Record<string, unknown> = {
    '/users/@me/guilds?limit=200': [{ id: '1', name: 'Owned' }, { id: '2', name: 'Moderated' }, { id: '3', name: 'Ordinary' }, { id: '4', name: 'Not a member' }],
    ['/guilds/1/members/' + id]: { roles: [] },
    ['/guilds/2/members/' + id]: { roles: ['mod'] },
    ['/guilds/3/members/' + id]: { roles: [] },
    '/guilds/1': { id: '1', name: 'Owned', owner_id: id, roles: [] },
    '/guilds/2': { id: '2', name: 'Moderated', owner_id: 'other', roles: [{ id: 'mod', permissions: '1099511627776' }] },
    '/guilds/3': { id: '3', name: 'Ordinary', owner_id: 'other', roles: [{ id: '3', permissions: '1024' }] },
  };
  const calls: string[] = [];
  const fetcher = (async (url: any, init: any) => {
    assert.equal(init.headers.Authorization, 'Bot test-bot-token');
    const path = String(url).replace('https://discord.com/api/v10', ''); calls.push(path);
    return new Response(JSON.stringify(fixture[path] || { message: 'Unknown Member' }), { status: fixture[path] ? 200 : 404 });
  }) as typeof fetch;
  const result = await botAccountGuilds(id, 'test-bot-token', fetcher);
  assert.deepEqual(result.guilds.map(g => g.name), ['Owned', 'Moderated']);
  assert.equal(result.discordUserId, id);
  assert(!calls.some(path => path.includes('oauth2')));
});
test('typed usernames are rejected before querying server membership', async () => {
  await assert.rejects(botAccountGuilds('thecaptaindash', 'token'), /Link your Discord/);
  await assert.rejects(botAccountGuilds('1136132698746921110', ''), /not configured/);
});
