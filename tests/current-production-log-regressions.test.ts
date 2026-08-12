import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const start = fs.readFileSync('scripts/start.sh', 'utf8');
const watcher = fs.readFileSync('scripts/watch-mtfixit-twitch.ts', 'utf8');
const chat = fs.readFileSync('src/lib/twitch-chat-service.ts', 'utf8');
const discord = fs.readFileSync('src/lib/discord-sync-service.ts', 'utf8');
const mtfixit = fs.readFileSync('src/lib/mtfixit-service.ts', 'utf8');
const gateway = fs.readFileSync('src/app/api/discord/gateway-ingress/route.ts', 'utf8');
const serviceToken = fs.readFileSync('src/lib/spmt-service-token.ts', 'utf8');
const runtimeConfig = fs.readFileSync('src/lib/runtime-config.ts', 'utf8');

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

test('SPMT OAuth authority follows volume-backed public runtime config', () => {
  assert.ok(runtimeConfig.includes("spmtUrl: 'https://spmt.live'"));
  assert.ok(runtimeConfig.includes('getSpmtUrl'));
  assert.ok(serviceToken.includes("import { getSpmtUrl } from './runtime-config'"));
  assert.ok(serviceToken.includes('getSpmtUrl().replace'));
  assert.ok(!serviceToken.includes('process.env.SPMT_BASE_URL'));
});

test('MtFixIt watcher owns reconnects and stale disconnects cannot clear the active timer', () => {
  assert.ok(watcher.includes('connection: { reconnect: false }'));
  assert.ok(watcher.includes('if (activeClient !== client)'));
  assert.ok(watcher.includes('Ignoring stale disconnect'));
  assert.ok(watcher.includes('clearRefreshTimer'));
});

test('Twitch banned-channel notice drives the long join cooldown', () => {
  assert.ok(chat.includes("this.client.on('notice'"));
  assert.ok(chat.includes('channelJoinNotice'));
  assert.ok(chat.includes('msg_banned|banned'));
  assert.ok(chat.includes('6 * 60 * 60 * 1000'));
});

test('Discord waits for the real 30046 edit cap instead of reposting every one-hour-old message', () => {
  assert.ok(!discord.includes('isOlderThanDiscordEditWindow'));
  assert.ok(!discord.includes('preemptive-old-message'));
  assert.ok(discord.includes('isExpectedEditLifecycleError'));
  assert.ok(discord.includes('Discord edit cap reached'));
});
