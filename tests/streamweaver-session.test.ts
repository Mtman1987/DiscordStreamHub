import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyStreamWeaverSessionToken } from '../src/lib/streamweaver-session';

test('introspects the carried StreamWeaver session and trusts only the verified tenant', async () => {
  const token = 'signed_payload.signed_signature';
  let requestUrl = '';
  let cookieHeader = '';
  const session = await verifyStreamWeaverSessionToken(token, {
    baseUrl: 'https://streamweaver.example/',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      cookieHeader = new Headers(init?.headers).get('cookie') || '';
      return new Response(JSON.stringify({ id: 'tenant-from-session', username: 'athena-owner' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(requestUrl, 'https://streamweaver.example/api/session');
  assert.equal(cookieHeader, `streamweaver-session=${token}`);
  assert.deepEqual(session, { id: 'tenant-from-session', username: 'athena-owner', displayName: undefined });
});

test('rejects malformed or issuer-rejected session tokens', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('{}', { status: 401 });
  };
  assert.equal(await verifyStreamWeaverSessionToken('not-a-signed-session', {
    baseUrl: 'https://streamweaver.example', fetchImpl,
  }), null);
  assert.equal(calls, 0);
  assert.equal(await verifyStreamWeaverSessionToken('payload.signature', {
    baseUrl: 'https://streamweaver.example', fetchImpl,
  }), null);
  assert.equal(calls, 1);
});
