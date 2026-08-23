import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifestSource = fs.readFileSync('src/app/api/platform/manifest/route.ts', 'utf8');
const healthSource = fs.readFileSync('src/app/api/health/route.ts', 'utf8');

for (const marker of [
  "manifestVersion: 'spmt.app-manifest/v1'",
  "id: 'discord-stream-hub'",
  "healthUrl: 'https://discord-stream-hub-new.fly.dev/api/health'",
  "sdkPackage: '@spmt/sdk'",
  "eventOwner: 'discord-stream-hub'",
  "id: 'dsh-clip-worker'",
  "role: 'clip-processing'",
]) {
  assert.ok(manifestSource.includes(marker), `missing manifest marker: ${marker}`);
}

for (const capability of ['discord-community', 'shoutouts', 'calendar', 'moderation', 'signal', 'clips', 'messages', 'points', 'leaderboards']) {
  assert.ok(manifestSource.includes(`'${capability}'`), `missing capability: ${capability}`);
}

assert.match(healthSource, /manifestVersion:\s*'spmt\.app-manifest\/v1'/);
assert.match(healthSource, /manifestUrl:\s*'\/api\/platform\/manifest'/);
console.log('Discord Stream Hub flagship developer contract passed.');
