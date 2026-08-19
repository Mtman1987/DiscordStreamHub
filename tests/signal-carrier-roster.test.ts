import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const route = fs.readFileSync(path.join(root, 'src/app/api/internal/signal/carriers/route.ts'), 'utf8');

test('Signal carrier roster is authenticated and follows the DSH community shoutout group', () => {
  assert.match(route, /hasAuthorizedBearerToken/);
  assert.match(route, /getServiceToServiceSecrets/);
  assert.match(route, /isCommunityGroup\(user\?\.group\)/);
  assert.match(route, /twitchLogin \|\| user\?\.username \|\| user\?\.displayName/);
  assert.match(route, /kind: 'signal-carriers'/);
  assert.match(route, /'Cache-Control': 'private, no-store'/);
  assert.doesNotMatch(route, /where\('isOnline'/, 'Signal listening follows shoutout-list membership, not a potentially stale online snapshot');
});
