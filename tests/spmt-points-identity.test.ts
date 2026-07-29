import assert from 'node:assert/strict';
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
