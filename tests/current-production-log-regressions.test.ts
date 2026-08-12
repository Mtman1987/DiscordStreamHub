import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const start = fs.readFileSync('scripts/start.sh', 'utf8');
const watcher = fs.readFileSync('scripts/watch-mtfixit-twitch.ts', 'utf8');
const chat = fs.readFileSync('src/lib/twitch-chat-service.ts', 'utf8');
const discord = fs.readFileSync('src/lib/discord-sync-service.ts', 'utf8');
const mtfixit = fs.readFileSync('src/lib/mtfixit-service.ts', 'utf8');
const gateway = fs.readFileSync('src/app/api/discord/gateway-ingress/route.ts', 'utf8');

test('mtfixit uses SPMT OAuth rather than deprecated platform keys', () => {
  assert.match(start, /DSH_CLIENT_SECRET/);
  assert.doesNotMatch(start, /SPMT_API_KEY.*mtfixit watcher/);
  assert.match(mtfixit, /getSpmtServiceToken\(\['athena:write'\]\)/);
  assert.doesNotMatch(mtfixit, /x-dsh-mtfixit-key|SPMT_API_KEY/);
});

test('Discord gateway authenticates ChatTag delivery with scoped SPMT OAuth', () => {
  assert.match(gateway, /getSpmtServiceToken\(\['discord:control'\]\)/);
  assert.ok(gateway.includes('authorization:'));
  assert.ok(gateway.includes('Bearer '));
});

test('Twitch watchers bound retries and do not let one failed channel abort refresh', () => {
  assert.match(watcher, /activeClient !== client/);
  assert.match(watcher, /clearRefreshTimer/);
  assert.match(watcher, /channelRetryAfter/);
  assert.match(chat, /channelJoinRetryAfter/);
  assert.match(chat, /msg_banned/);
});

test('old Discord messages are reposted before hitting the edit-cap 429', () => {
  assert.match(discord, /isOlderThanDiscordEditWindow/);
  assert.match(discord, /30046 preemptive-old-message/);
});
