import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveTwitchPointsIdentity } from '../src/lib/spmt-points-identity';

test('uses an explicit Twitch ID from event metadata', () => {
  assert.deepEqual(resolveTwitchPointsIdentity({
    sourceUserId: '767875979561009173',
    fallbackUsername: 'Mtman1987',
    metadata: { twitchId: '94371378', twitchLogin: 'Mtman1987' },
    linkedUserExists: true,
  }), {
    provider: 'twitch',
    providerUserId: '94371378',
    providerUsername: 'mtman1987',
  });
});

test('uses a linked Twitch ID when event metadata omits it', () => {
  assert.deepEqual(resolveTwitchPointsIdentity({
    sourceUserId: '767875979561009173',
    fallbackUsername: 'Mtman1987',
    linkedUser: { twitchId: '94371378', twitchLogin: 'Mtman1987' },
    linkedUserExists: true,
  }), {
    provider: 'twitch',
    providerUserId: '94371378',
    providerUsername: 'mtman1987',
  });
});

test('never reinterprets the Discord document key as a Twitch ID', () => {
  assert.deepEqual(resolveTwitchPointsIdentity({
    sourceUserId: '767875979561009173',
    fallbackUsername: 'Mtman1987',
    metadata: { username: 'Mtman1987' },
    linkedUserExists: true,
  }), {
    provider: 'discord',
    providerUserId: '767875979561009173',
    providerUsername: 'Mtman1987',
  });
});

test('returns null when neither provider identity can be proven', () => {
  assert.equal(resolveTwitchPointsIdentity({
    sourceUserId: 'unknown',
    fallbackUsername: 'someone',
    linkedUserExists: false,
  }), null);
});

test('SPMT identity events and XP use the existing DSH service-token helper', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/spmt-client.ts'), 'utf8');
  assert.match(source, /getSpmtServiceToken\(\[scope\]\)/);
  assert.match(source, /spmtPlatformFetch\('identity:write'/);
  assert.match(source, /spmtPlatformFetch\('events:write'/);
  assert.match(source, /spmtPlatformFetch\('xp:write'/);
  assert.match(source, /clearSpmtServiceTokenCache\(\)/);
  assert.match(source, /process\.env\.DSH_CLIENT_SECRET \|\| SPMT_API_KEY/);
});

test('DSH service tokens are cached per normalized scope set instead of one global slot', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/spmt-service-token.ts'), 'utf8');
  assert.match(source, /const cached = new Map<string, ServiceToken>\(\)/);
  assert.match(source, /const inFlight = new Map<string, Promise<string>>\(\)/);
  assert.match(source, /const key = requested\.join\(' '\)/);
  assert.match(source, /cached\.get\(key\)/);
  assert.match(source, /cached\.set\(key,/);
});
