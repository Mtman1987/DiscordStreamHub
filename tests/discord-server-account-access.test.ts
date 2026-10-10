import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as servers, POST as select } from '../src/app/api/discord/servers/route';
import { GET as restore } from '../src/app/api/auth/restore-session/route';
import { GET as authorize } from '../src/app/api/discord/servers/authorize/route';
import { GET as dbRead, POST as dbWrite, PATCH as dbPatch, DELETE as dbDelete } from '../src/app/api/db/route';
import { buildDshSpmtSession } from '../src/lib/spmt-session';
test('server discovery, authorization and identity restore require a verified account', async () => {
  for (const endpoint of [servers, authorize, restore]) {
    const response = await endpoint(new NextRequest('https://dsh.test/api?userId=another-user&serverId=1240832965865635881'));
    assert.equal(response.status, 401);
  }
});
test('cross-origin server selection is denied before writing state', async () => {
  const response = await select(new NextRequest('https://dsh.test/api/discord/servers', {
    method: 'POST', headers: { origin: 'https://untrusted.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ guildId: '1240832965865635881' }),
  }));
  assert.equal(response.status, 403);
});
test('generic database API cannot expose or forge Discord account connections', async () => {
  for (const collection of ['discordServerOAuth', 'discordServerConnections']) {
    for (const endpoint of [dbRead, dbDelete]) {
      const response = await endpoint(new NextRequest('https://dsh.test/api/db?path=' + collection + '/user'));
      assert.equal(response.status, 403);
    }
    for (const endpoint of [dbWrite, dbPatch]) {
      const response = await endpoint(new NextRequest('https://dsh.test/api/db', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: collection + '/user', data: { selectedServerId: 'foreign-server' } }),
      }));
      assert.equal(response.status, 403);
    }
  }
});
test('a tenant without a selected server is not assigned Space Mountain', () => {
  const session = buildDshSpmtSession({ id: 'tenant-dash', username: 'thecaptaindash', discordId: '1136132698746921110' });
  assert.equal(session.discordServerId, '');
});
