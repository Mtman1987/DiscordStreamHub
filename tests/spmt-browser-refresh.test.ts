import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
test('DSH stores rotated cookies for embedded use and returns the existing linked identity', async (t) => {
  const originalFetch = globalThis.fetch;
  const env = process.env as Record<string, string | undefined>;
  const originalEnv = env.NODE_ENV;
  env.NODE_ENV = 'production';
  process.env.DSH_CLIENT_SECRET = 'test-client';
  t.after(() => { globalThis.fetch = originalFetch; if (originalEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = originalEnv; });
  globalThis.fetch = async (input) => String(input).endsWith('/api/oauth/userinfo')
    ? new Response('{}', { status: 401 })
    : new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', user: { id: 'canonical-user', username: 'existing-user', twitchUsername: 'existing_twitch', discordId: '987654321000', discordUsername: 'existing_discord' } }));
  const { GET } = await import('../src/app/api/auth/spmt-session/route');
  const req = new NextRequest('https://discord-stream-hub-new.fly.dev/api/auth/spmt-session', { headers: { cookie: 'dsh_spmt_session=old; dsh_spmt_refresh=saved' } });
  const res = await GET(req);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /dsh_spmt_refresh=new-refresh/);
  assert.match(res.headers.get('set-cookie') || '', /SameSite=none/i);
  const data = await res.json();
  assert.equal(data.session.spmtUserId, 'canonical-user');
  assert.equal(data.session.discordUserId, '987654321000');
  assert.equal(data.session.twitchUsername, 'existing_twitch');
});
