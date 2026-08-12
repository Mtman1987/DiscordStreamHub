const fs = require('node:fs');

function patch(path, before, after, label) {
  let source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`${label} marker changed in ${path}`);
  source = source.replace(before, after);
  fs.writeFileSync(path, source);
}

// Public SPMT authority belongs in the volume-backed runtime config.
patch(
  'src/lib/runtime-config.ts',
  "    streamweaverUrl: 'https://streamweaver-new.fly.dev',\n    discordInviteUrl:",
  "    streamweaverUrl: 'https://streamweaver-new.fly.dev',\n    spmtUrl: 'https://spmt.live',\n    discordInviteUrl:",
  'SPMT runtime URL default',
);
patch(
  'src/lib/runtime-config.ts',
  "      streamweaverUrl: ['STREAMWEAVER_URL', 'STREAMWEAVE_URL'],\n      discordInviteUrl:",
  "      streamweaverUrl: ['STREAMWEAVER_URL', 'STREAMWEAVE_URL'],\n      spmtUrl: ['SPMT_BASE_URL'],\n      discordInviteUrl:",
  'SPMT runtime URL env map',
);
patch(
  'src/lib/runtime-config.ts',
  "export function getStreamweaverUrl(): string {\n  return getRuntimePublicUrl('streamweaverUrl');\n}\n",
  "export function getStreamweaverUrl(): string {\n  return getRuntimePublicUrl('streamweaverUrl');\n}\n\nexport function getSpmtUrl(): string {\n  return getRuntimePublicUrl('spmtUrl');\n}\n",
  'SPMT runtime URL getter',
);

// Only the OAuth client secret stays in env; public authority comes from runtime JSON.
{
  const path = 'src/lib/spmt-service-token.ts';
  let source = fs.readFileSync(path, 'utf8');
  const before = "const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\\/$/, '');\n";
  if (!source.includes(before)) throw new Error('SPMT service token base URL marker changed');
  source = source.replace(before, "import { getSpmtUrl } from './runtime-config';\n");
  source = source.replace(
    "  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {",
    "  const spmtBaseUrl = getSpmtUrl().replace(/\\/$/, '');\n  const response = await fetch(`${spmtBaseUrl}/api/oauth/token`, {",
  );
  fs.writeFileSync(path, source);
}

// We own reconnects for the standalone watcher; disable tmi.js auto reconnect and ignore stale disconnects.
patch(
  'scripts/watch-mtfixit-twitch.ts',
  "    options: { debug: false },\n    identity:",
  "    options: { debug: false },\n    connection: { reconnect: false },\n    identity:",
  'MtFixIt reconnect ownership',
);
patch(
  'scripts/watch-mtfixit-twitch.ts',
  "  client.on('disconnected', (reason) => {\n    if (activeClient === client) activeClient = null;\n    clearRefreshTimer();\n    console.warn(`[MtFixIt:Twitch] Disconnected: ${reason}`);\n    scheduleReconnect(String(reason || 'disconnected'));\n  });",
  "  client.on('disconnected', (reason) => {\n    if (activeClient !== client) {\n      console.warn(`[MtFixIt:Twitch] Ignoring stale disconnect: ${reason}`);\n      return;\n    }\n    activeClient = null;\n    clearRefreshTimer();\n    console.warn(`[MtFixIt:Twitch] Disconnected: ${reason}`);\n    scheduleReconnect(String(reason || 'disconnected'));\n  });",
  'MtFixIt stale disconnect handling',
);

// An old Discord message can still be edited until Discord reports code 30046; do not repost just because it is old.
{
  const path = 'src/lib/discord-sync-service.ts';
  let source = fs.readFileSync(path, 'utf8');
  const helper = `  private readonly discordEpochMs = 1420070400000;\n  private readonly oldMessageEditWindowMs = 60 * 60 * 1000;\n\n  private isOlderThanDiscordEditWindow(messageId: string): boolean {\n    try {\n      const createdAt = Number((BigInt(messageId) >> BigInt(22)) + BigInt(this.discordEpochMs));\n      return Number.isFinite(createdAt) && Date.now() - createdAt >= this.oldMessageEditWindowMs;\n    } catch {\n      return false;\n    }\n  }\n\n`;
  if (!source.includes(helper)) throw new Error('Discord age precheck helper changed');
  source = source.replace(helper, '');
  const precheck = `      if (this.isOlderThanDiscordEditWindow(messageId)) {\n        throw new Error(\`Discord edit needs repost for ${'${messageId}'} in ${'${channelId}'}: 30046 preemptive-old-message\`);\n      }\n`;
  if (!source.includes(precheck)) throw new Error('Discord age precheck call changed');
  source = source.replace(precheck, '');
  source = source.replace(
    "          console.warn(`Discord edit needs repost for ${messageId} in ${channelId}: ${response.status} ${errorText}`);",
    "          console.log(`[DiscordSync] Discord edit cap reached for ${messageId}; caller will repost.`);",
  );
  fs.writeFileSync(path, source);
}

// tmi.js surfaces msg_banned as a NOTICE while join() later rejects with "No response from Twitch".
{
  const path = 'src/lib/twitch-chat-service.ts';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(
    "  private channelJoinRetryAfter: Map<string, number> = new Map();",
    "  private channelJoinRetryAfter: Map<string, number> = new Map();\n  private channelJoinNotice: Map<string, { messageId: string; message: string; at: number }> = new Map();",
  );
  const partBlock = `    this.client.on('part', (channel) => {\n      const normalized = normalizeChannel(channel);\n      if (normalized) {\n        this.joinedChannels.delete(normalized);\n        this.athenaChannelAccess.delete(normalized);\n      }\n    });\n`;
  if (!source.includes(partBlock)) throw new Error('Twitch part listener marker changed');
  source = source.replace(partBlock, `${partBlock}    this.client.on('notice', (channel, messageId, message) => {\n      const normalized = normalizeChannel(channel);\n      if (!normalized) return;\n      this.channelJoinNotice.set(normalized, {\n        messageId: String(messageId || ''),\n        message: String(message || ''),\n        at: Date.now(),\n      });\n    });\n`);
  source = source.replace(
    "        this.channelJoinRetryAfter.delete(normalized);\n        this.joinedChannels.add(normalized);",
    "        this.channelJoinRetryAfter.delete(normalized);\n        this.channelJoinNotice.delete(normalized);\n        this.joinedChannels.add(normalized);",
  );
  const catchBlock = `      } catch (error) {\n        const message = error instanceof Error ? error.message : String(error);\n        const retryMs = /msg_banned|banned/i.test(message) ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000;\n        this.channelJoinRetryAfter.set(normalized, now + retryMs);\n        this.lastError = \`Join #${'${normalized}'}: ${'${message}'}\`;\n        console.warn(\`[TwitchChat] Could not join #${'${normalized}'}; retrying later: ${'${message}'}\`);\n      }`;
  const replacement = `      } catch (error) {\n        const message = error instanceof Error ? error.message : String(error);\n        const notice = this.channelJoinNotice.get(normalized);\n        const recentNotice = notice && now - notice.at <= 30_000 ? notice : null;\n        const noticeText = recentNotice ? \`${'${recentNotice.messageId}'} ${'${recentNotice.message}'}\` : '';\n        const banned = /msg_banned|banned/i.test(\`${'${message}'} ${'${noticeText}'}\`);\n        const retryMs = banned ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000;\n        this.channelJoinRetryAfter.set(normalized, now + retryMs);\n        this.lastError = \`Join #${'${normalized}'}: ${'${recentNotice?.messageId || message}'}\`;\n        console.warn(\`[TwitchChat] Could not join #${'${normalized}'}; retrying in ${'${Math.round(retryMs / 60_000)}'}m: ${'${recentNotice?.messageId || message}'}\`);\n      }`;
  if (!source.includes(catchBlock)) throw new Error('Twitch join catch marker changed');
  source = source.replace(catchBlock, replacement);
  source = source.replace(
    "        this.channelJoinRetryAfter.delete(channel);\n        this.joinedChannels.delete(channel);",
    "        this.channelJoinRetryAfter.delete(channel);\n        this.channelJoinNotice.delete(channel);\n        this.joinedChannels.delete(channel);",
  );
  source = source.replace(
    "      if (!liveChannels.includes(channel)) this.channelJoinRetryAfter.delete(channel);",
    "      if (!liveChannels.includes(channel)) {\n        this.channelJoinRetryAfter.delete(channel);\n        this.channelJoinNotice.delete(channel);\n      }",
  );
  source = source.replace(
    "    this.channelJoinRetryAfter.clear();\n    this.athenaChannelAccess.clear();",
    "    this.channelJoinRetryAfter.clear();\n    this.channelJoinNotice.clear();\n    this.athenaChannelAccess.clear();",
  );
  fs.writeFileSync(path, source);
}

fs.writeFileSync('tests/current-production-log-regressions.test.ts', `import fs from 'node:fs';\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\n\nconst start = fs.readFileSync('scripts/start.sh', 'utf8');\nconst watcher = fs.readFileSync('scripts/watch-mtfixit-twitch.ts', 'utf8');\nconst chat = fs.readFileSync('src/lib/twitch-chat-service.ts', 'utf8');\nconst discord = fs.readFileSync('src/lib/discord-sync-service.ts', 'utf8');\nconst mtfixit = fs.readFileSync('src/lib/mtfixit-service.ts', 'utf8');\nconst gateway = fs.readFileSync('src/app/api/discord/gateway-ingress/route.ts', 'utf8');\nconst serviceToken = fs.readFileSync('src/lib/spmt-service-token.ts', 'utf8');\nconst runtimeConfig = fs.readFileSync('src/lib/runtime-config.ts', 'utf8');\n\ntest('mtfixit uses SPMT OAuth rather than deprecated platform keys', () => {\n  assert.match(start, /DSH_CLIENT_SECRET/);\n  assert.doesNotMatch(start, /SPMT_API_KEY.*mtfixit watcher/);\n  assert.match(mtfixit, /getSpmtServiceToken\\(\\['athena:write'\\]\\)/);\n  assert.doesNotMatch(mtfixit, /x-dsh-mtfixit-key|SPMT_API_KEY/);\n});\n\ntest('Discord gateway authenticates ChatTag delivery with scoped SPMT OAuth', () => {\n  assert.match(gateway, /getSpmtServiceToken\\(\\['discord:control'\\]\\)/);\n  assert.ok(gateway.includes('authorization:'));\n  assert.ok(gateway.includes('Bearer '));\n});\n\ntest('SPMT OAuth authority follows volume-backed public runtime config', () => {\n  assert.ok(runtimeConfig.includes("spmtUrl: 'https://spmt.live'"));\n  assert.ok(runtimeConfig.includes('getSpmtUrl'));\n  assert.ok(serviceToken.includes("import { getSpmtUrl } from './runtime-config'"));\n  assert.ok(serviceToken.includes('getSpmtUrl().replace'));\n  assert.ok(!serviceToken.includes('process.env.SPMT_BASE_URL'));\n});\n\ntest('MtFixIt watcher owns reconnects and stale disconnects cannot clear the active timer', () => {\n  assert.ok(watcher.includes('connection: { reconnect: false }'));\n  assert.ok(watcher.includes('if (activeClient !== client)'));\n  assert.ok(watcher.includes('Ignoring stale disconnect'));\n  assert.ok(watcher.includes('clearRefreshTimer'));\n});\n\ntest('Twitch banned-channel notice drives the long join cooldown', () => {\n  assert.ok(chat.includes("this.client.on('notice'"));\n  assert.ok(chat.includes('channelJoinNotice'));\n  assert.ok(chat.includes('msg_banned|banned'));\n  assert.ok(chat.includes('6 * 60 * 60 * 1000'));\n});\n\ntest('Discord waits for the real 30046 edit cap instead of reposting every one-hour-old message', () => {\n  assert.ok(!discord.includes('isOlderThanDiscordEditWindow'));\n  assert.ok(!discord.includes('preemptive-old-message'));\n  assert.ok(discord.includes('isExpectedEditLifecycleError'));\n  assert.ok(discord.includes('Discord edit cap reached'));\n});\n`);
