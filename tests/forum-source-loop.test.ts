
import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/discord/forward-to-forum/route';
test('forum/media parents and posts inside their threads never enter forwarding or website mirrors', async () => {
  const fetchBefore = globalThis.fetch, tokenBefore = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'mock-only';
  const writes: string[] = [];
  globalThis.fetch = async (input: any, init: any = {}) => {
    const path = new URL(String(input)).pathname.replace('/api/v10', '');
    if (init.method && init.method !== 'GET') writes.push(path);
    let body;
    if (path === '/guilds/110000000000000001') body = { name: 'Source' };
    else if (path === '/channels/440000000000000001') body = { id: '440000000000000001', name: 'forum', type: 15 };
    else if (path === '/channels/440000000000000002') body = { id: '440000000000000002', name: 'forum post', type: 11, parent_id: '440000000000000001' };
    else if (path === '/channels/440000000000000003') body = { id: '440000000000000003', name: 'media', type: 16 };
    else throw new Error('Unexpected forwarding call: ' + path);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const channelId of ['440000000000000001', '440000000000000002', '440000000000000003']) {
      const response = await POST(new NextRequest('https://dsh.test/api/discord/forward-to-forum', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-discord-bot-token': 'mock-only' },
        body: JSON.stringify({ guildId: '110000000000000001', channelId, messageId: '550000000000000001', userName: 'Human', message: 'A forum reply should never mirror back.' }),
      }));
      assert.equal(response.status, 200); assert.equal((await response.json()).skipped, 'source-forum-channel');
    }
    assert.deepEqual(writes, []);
  } finally { globalThis.fetch = fetchBefore; if (tokenBefore === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = tokenBefore; }
});
