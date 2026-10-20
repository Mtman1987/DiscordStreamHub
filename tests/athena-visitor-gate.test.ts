import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isOwnerAthenaInvocation, isVisitorAthenaInvocation } from '../src/lib/athena-visitor-gate';

test('owner gets loose Athena invocation matching', () => {
  assert.equal(isOwnerAthenaInvocation('Athena can you help?'), true);
  assert.equal(isOwnerAthenaInvocation('Hey Athena, what do you think?'), true);
  assert.equal(isOwnerAthenaInvocation('hi Athena'), true);
  assert.equal(isOwnerAthenaInvocation('can you help me, Athena?'), true);
  assert.equal(isOwnerAthenaInvocation('!athena tell me a joke'), true);
  assert.equal(isOwnerAthenaInvocation('@athenabot87 hello'), true);
  assert.equal(isOwnerAthenaInvocation('hello athena1234'), false);
  assert.equal(isOwnerAthenaInvocation('Athena1234 said hello'), false);
});

test('non-owners must begin with the complete bot username', () => {
  assert.equal(isVisitorAthenaInvocation('@athenabot87 hello'), true);
  assert.equal(isVisitorAthenaInvocation('@AthenaBot87 can you help?'), true);
  assert.equal(isVisitorAthenaInvocation('@customathena hello', 'customathena'), true);
  assert.equal(isVisitorAthenaInvocation('Athena can you help?'), false);
  assert.equal(isVisitorAthenaInvocation('Hey Athena, what do you think?'), false);
  assert.equal(isVisitorAthenaInvocation('!athena tell me a joke'), false);
  assert.equal(isVisitorAthenaInvocation('hi @athenabot87'), false);
  assert.equal(isVisitorAthenaInvocation('@athena hello'), false);
});

test('visitor access is one channel for ten minutes and does not require membership', () => {
  const source = readFileSync(
    new URL('../src/lib/twitch-chat-service.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /ATHENA_OWNER_WINDOW_MS = 10 \* 60 \* 1000/);
  assert.match(source, /activeAthenaVisitorWindow: AthenaVisitorWindow \| null/);
  assert.match(source, /activeWindow\.channel !== channel/);
  assert.match(source, /activeWindow\.ownerWindowUntil <= now/);
  assert.match(source, /isVisitorAthenaInvocation\(input\.message, this\.athenaBotUsername\)/);
  assert.doesNotMatch(source, /ownerWindowOpen && input\.isSpmtMember/);
});

test('live chat selection depends on DSH shoutout state, not StreamWeaver or Chat Tag installation', () => {
  const source = readFileSync(
    new URL('../src/lib/twitch-chat-service.ts', import.meta.url),
    'utf8',
  );
  const selector = source.match(
    /private async getLiveChannels\(\): Promise<string\[]> \{[\s\S]*?return liveChannels;\n  \}/,
  )?.[0] || '';

  assert.ok(selector);
  assert.match(selector, /shoutoutState\.data\(\)\?\.isLive/);
  assert.match(selector, /doc\.data\(\)\.twitchLogin/);
  assert.doesNotMatch(selector, /streamweaver|chat.?tag/i);
});

test('persists Discord ingress watermarks before routing public or private messages', () => {
  const route = readFileSync(
    new URL('../src/app/api/discord/chat/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(route, /runtime'\)\.doc\('discord-message-dedupe'/);
  assert.match(route, /watermarks\[lane\] = messageId/);
  assert.match(route, /compareDiscordMessageIds\(messageId, watermark\) <= 0/);
  assert.match(route, /if \(await markDiscordMessageSeen\(/);
  assert.match(route, /data\.createdAt \|\| data\.created_at \|\| data\.timestamp/);
  assert.match(route, /createdAtMs < PROCESS_STARTED_AT - INITIAL_EVENT_GRACE_MS/);
  assert.match(route, /if \(staleEvent\)/);
});
