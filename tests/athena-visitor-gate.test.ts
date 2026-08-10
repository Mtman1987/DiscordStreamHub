import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isExplicitAthenaInvocation } from '../src/lib/athena-visitor-gate';

test('accepts unmistakable Athena invocations', () => {
  assert.equal(isExplicitAthenaInvocation('Athena can you help?'), true);
  assert.equal(isExplicitAthenaInvocation('Hey Athena, what do you think?'), true);
  assert.equal(isExplicitAthenaInvocation('!athena tell me a joke'), true);
  assert.equal(isExplicitAthenaInvocation('@athenabot87 hello'), true);
});

test('ignores conversation about Athena and similarly named viewers', () => {
  assert.equal(isExplicitAthenaInvocation("where's Athena?"), false);
  assert.equal(isExplicitAthenaInvocation('hi Athena'), false);
  assert.equal(isExplicitAthenaInvocation('hello athena1234'), false);
  assert.equal(isExplicitAthenaInvocation('Athena1234 said hello'), false);
  assert.equal(isExplicitAthenaInvocation('the Athena bot is neat'), false);
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
