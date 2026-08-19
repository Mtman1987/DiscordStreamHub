import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const route = fs.readFileSync(path.join(root, 'src/app/api/internal/signal/carriers/route.ts'), 'utf8');
const destination = fs.readFileSync(path.join(root, 'src/app/api/internal/signal/channel/route.ts'), 'utf8');

test('Signal carrier roster is authenticated and follows the DSH community shoutout group', () => {
  assert.match(route, /hasAuthorizedBearerToken/);
  assert.match(route, /getServiceToServiceSecrets/);
  assert.match(route, /isCommunityGroup\(user\?\.group\)/);
  assert.match(route, /twitchLogin \|\| user\?\.username \|\| user\?\.displayName/);
  assert.match(route, /kind: 'signal-carriers'/);
  assert.match(route, /'Cache-Control': 'private, no-store'/);
  assert.doesNotMatch(route, /where\('isOnline'/, 'Signal listening follows shoutout-list membership, not a potentially stale online snapshot');
});

test('Signal destination is owned and resolved by DiscordStreamHub', () => {
  assert.match(destination, /hasAuthorizedBearerToken/);
  assert.match(destination, /getServiceToServiceSecrets/);
  assert.match(destination, /SIGNAL_CHANNEL_NAME = 'comms-lounge'/);
  assert.match(destination, /collection\('channels'\)/);
  assert.match(destination, /where\('name', '==', SIGNAL_CHANNEL_NAME\)/);
  assert.match(destination, /DISCORD_BOT_TOKEN/);
  assert.match(destination, /discord\.com\/api\/v10\/guilds\/\$\{SERVER_ID\}\/channels/);
  assert.match(destination, /kind: 'signal-destination'/);
  assert.match(destination, /guildId: SERVER_ID/);
  assert.match(destination, /channelId/);
  assert.match(destination, /'Cache-Control': 'private, no-store'/);
});
