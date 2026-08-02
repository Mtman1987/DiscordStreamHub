import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverDirectChildIds,
  resolveServerBranding,
  resolveTenantBalance,
} from '../src/lib/tenant-utils';

test('discovers tenants represented only by nested records', () => {
  assert.deepEqual(discoverDirectChildIds('servers', [
    'servers/root-tenant',
    'servers/points-only/leaderboard/user-1',
    'servers/activity-only/users/user-2',
    'other/ignored',
  ]), ['activity-only', 'points-only', 'root-tenant']);
});

test('uses the supported branding document before legacy root fields', () => {
  assert.deepEqual(resolveServerBranding(
    'tenant-1',
    { serverName: 'Discord Guild Name' },
    {
      serverName: 'Configured Community',
      communityMemberName: 'Pilot',
      communityMemberNamePlural: 'Pilots',
    },
  ), {
    serverName: 'Configured Community',
    communityMemberName: 'Pilot',
    communityMemberNamePlural: 'Pilots',
  });
});

test('falls back to a root tenant name instead of labeling every tenant Space Mountain', () => {
  assert.equal(resolveServerBranding('tenant-2', { name: 'Other Guild' }).serverName, 'Other Guild');
  assert.equal(resolveServerBranding('tenant-3').serverName, 'tenant-3');
});

test('uses the primary-guild default only after supported legacy names', () => {
  assert.equal(resolveServerBranding(
    'primary-guild',
    { twitchChannel: 'Legacy Community' },
    {},
    'Space Mountain',
  ).serverName, 'Legacy Community');
  assert.equal(resolveServerBranding(
    'primary-guild',
    {},
    {},
    'Space Mountain',
  ).serverName, 'Space Mountain');
});

test('canonical wallet values override stale legacy points and rank', () => {
  assert.deepEqual(resolveTenantBalance({
    currentPoints: 75,
    lifetimePoints: 400,
    rank: 3,
  }, 250, 8), {
    currentPoints: 75,
    lifetimePoints: 400,
    rank: 3,
    source: 'spmt',
  });
});
