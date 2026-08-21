import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildMtFixItJobRequest,
  mtFixItPublicReply,
  parseMtFixItCommand,
  resolveTwitchMtFixItTenantId,
} from '../src/lib/mtfixit-contract';
import { captureCommlinkDiagnosticSnapshot, mtFixItCommlinkContract } from '../src/lib/mtfixit-commlink';

function source(path: string) { return readFileSync(resolve(process.cwd(), path), 'utf8'); }

test('parses mtfixit case-insensitively, supports quoted reports, and preserves the report', () => {
  assert.equal(parseMtFixItCommand('!mtfixit leaderboard image timed out'), 'leaderboard image timed out');
  assert.equal(parseMtFixItCommand('  !MTFIXIT   Discord relay returned 404  '), 'Discord relay returned 404');
  assert.equal(parseMtFixItCommand(`!mtfixit "I can't tag people even though im it"`), `I can't tag people even though im it`);
  assert.equal(parseMtFixItCommand('!athena hello'), null);
});

test('distinguishes a missing description from a non-mtfixit message', () => {
  assert.equal(parseMtFixItCommand('!mtfixit'), '');
  assert.equal(parseMtFixItCommand('!mtfixit   '), '');
  assert.equal(parseMtFixItCommand('hello !mtfixit'), null);
});

test('resolves Twitch tenant metadata without making it evidence authority', () => {
  assert.equal(resolveTwitchMtFixItTenantId('123456789', '987654321'), '123456789');
  assert.equal(resolveTwitchMtFixItTenantId(undefined, '987654321'), '987654321');
  assert.equal(resolveTwitchMtFixItTenantId('not-a-twitch-id', '987654321'), '987654321');
  assert.equal(resolveTwitchMtFixItTenantId('not-a-twitch-id', 'also-bad'), undefined);
});

test('builds a DSH-owned rotator request without publication authority', () => {
  const request = buildMtFixItJobRequest({
    source: 'discord', reporter: 'Crew Member', reporterId: 'discord-123', tenantId: 'guild-1',
    channelId: 'channel-2', channelName: 'support', guildId: 'guild-1', messageId: 'message-3',
    description: 'The leaderboard image generator timed out.',
  });
  assert.equal(request.source, 'dsh:discord');
  assert.equal(request.reporterId, 'discord-123');
  assert.equal(request.description, 'The leaderboard image generator timed out.');
  assert.deepEqual(request.context, { source: 'discord', channelId: 'channel-2', channelName: 'support', guildId: 'guild-1', messageId: 'message-3' });
  assert.equal('publish' in request, false);
});

test('public replies match the conversational Athena lifecycle without exposing internals', () => {
  for (const outcome of ['accepted', 'fixed', 'waiting-review', 'no-change', 'failed'] as const) {
    const reply = mtFixItPublicReply(outcome);
    assert.match(reply, /Athena/i);
    assert.doesNotMatch(reply, /Athena\s+Coder/i);
    assert.doesNotMatch(reply, /\bowner\b/i);
    assert.doesNotMatch(reply, /mtfix_[a-z0-9_-]+/i);
  }
  assert.match(mtFixItPublicReply('accepted'), /snapshot/i);
  assert.match(mtFixItPublicReply('accepted'), /message you back here/i);
  assert.match(mtFixItPublicReply('waiting-review'), /mtman/i);
  assert.match(mtFixItPublicReply('usage'), /!mtfixit/i);
  assert.doesNotMatch(mtFixItPublicReply('failed'), /exception|token|secret|http\s+\d+/i);
});

test('mtfixit Commlink evidence is ecosystem-global and never requires a tenant id', async () => {
  assert.equal(mtFixItCommlinkContract.scope, 'ecosystem-global');
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.SPMT_BASE_URL;
  let requestedUrl = '';
  let requestedAuth = '';
  process.env.SPMT_BASE_URL = 'https://spmt.test';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedAuth = String((init?.headers as Record<string, string> | undefined)?.authorization || '');
    return new Response(JSON.stringify({
      schemaVersion: 'commlink.diagnostic-feed/v1', scope: 'ecosystem-global', count: 2, totalMatched: 2,
      sourceCounts: { messages: 2 },
      items: [
        { id: 'tenant-a-message', timestamp: '2026-08-17T21:00:00.000Z', text: 'A' },
        { id: 'tenant-b-message', timestamp: '2026-08-17T21:00:01.000Z', text: 'B' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const snapshot = await captureCommlinkDiagnosticSnapshot({ serviceKey: 'shared-service-key', capturedAt: '2026-08-17T21:01:00.000Z', source: 'twitch' });
    assert.equal(snapshot.status, 'captured');
    assert.equal(snapshot.scope, 'ecosystem-global');
    assert.match(requestedUrl, /\/api\/internal\/commlink\/diagnostic-feed\?/);
    assert.doesNotMatch(requestedUrl, /tenant/i);
    assert.equal(requestedAuth, 'Bearer shared-service-key');
    if (snapshot.status === 'captured') {
      assert.match(snapshot.snapshotJson, /tenant-a-message/);
      assert.match(snapshot.snapshotJson, /tenant-b-message/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.SPMT_BASE_URL;
    else process.env.SPMT_BASE_URL = originalBase;
  }
});

test('orchestrator notifies mtman at start, gates new fixes, and reports successful deployments back to chat', () => {
  const text = source('src/lib/mtfixit-orchestrator.ts');
  assert.match(text, /MtFixIt was used by/);
  assert.match(text, /has begun working the problem/);
  assert.match(text, /mtfixit_approve:\$\{jobId\}/);
  assert.match(text, /mtfixit_deny:\$\{jobId\}/);
  assert.match(text, /resolution\.status === 'awaiting_approval'/);
  assert.match(text, /resolution\.status === 'deployed'/);
  assert.match(text, /outcome: 'fixed'/);
  assert.match(text, /outcome: 'waiting-review'/);
});

test('Discord owns mtfixit before generic command fanout and repair decisions stay owner-restricted', () => {
  const ingress = source('src/app/api/discord/gateway-ingress/route.ts');
  const mtfixit = source('src/app/api/discord/mtfixit/route.ts');
  const discordDelivery = source('src/lib/mtfixit-discord-delivery.ts');
  const decisions = source('src/app/api/internal/mtfixit/decision/route.ts');
  const bot = source('scripts/discord-ingress-bot.ts');
  assert.ok(ingress.indexOf('if (isMtFixItCommand)') < ingress.indexOf('const dshUrl'));
  assert.match(ingress, /\/api\/discord\/mtfixit/);
  assert.match(mtfixit, /sendDiscordMtFixItMessage/);
  assert.match(discordDelivery, /author: \{ name: 'Athena'/);
  assert.match(decisions, /userId !== getMtmanDiscordId\(\)/);
  assert.match(bot, /\(mtfixit\|chatgpt\)_\(approve\|deny\)/);
  assert.match(bot, /kind = match\[1\]/);
  assert.match(bot, /\/api\/internal\/mtfixit\/decision/);
  assert.match(bot, /GatewayIntentBits\.DirectMessages/);
});

test('mtfixit original-chat delivery survives DSH self-deploy restarts', () => {
  const delivery = source('src/lib/mtfixit-delivery.ts');
  const discord = source('scripts/discord-ingress-bot.ts');
  const twitch = source('scripts/watch-mtfixit-twitch.ts');
  const discordRoute = source('src/app/api/discord/mtfixit/route.ts');
  assert.match(delivery, /MTFIXIT_DATA_DIR/);
  assert.match(delivery, /deliveries/);
  assert.match(delivery, /resumePendingMtFixItDeliveries/);
  assert.match(delivery, /resolution\?\.status === 'deployed'/);
  assert.match(delivery, /mtfixit_approve:\$\{record\.jobId\}/);
  assert.match(discord, /resumePendingMtFixItDeliveries\('discord'/);
  assert.match(twitch, /resumePendingMtFixItDeliveries\('twitch'/);
  assert.match(discordRoute, /registerMtFixItDelivery/);
  assert.match(twitch, /registerMtFixItDelivery/);
});
