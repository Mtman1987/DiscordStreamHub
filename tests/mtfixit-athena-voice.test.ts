import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mtFixItPublicReply } from '../src/lib/mtfixit-contract';

function source(path: string) { return readFileSync(resolve(process.cwd(), path), 'utf8'); }

test('MtFixIt public lifecycle speaks in Athena first person', () => {
  const accepted = mtFixItPublicReply('accepted');
  const waiting = mtFixItPublicReply('waiting-review');
  const fixed = mtFixItPublicReply('fixed');
  assert.match(accepted, /^I[’']/i);
  assert.match(accepted, /ecosystem snapshot/i);
  assert.match(waiting, /my ChatGPT review pass/i);
  assert.match(fixed, /^Found it\./i);
  assert.doesNotMatch(accepted, /^Athena /i);
});

test('Twitch MtFixIt watcher separates global listener from authenticated Athena reply identity', () => {
  const watcher = source('scripts/watch-mtfixit-twitch.ts');
  assert.match(watcher, /ATHENA_TWITCH_LOGIN = 'athenabot87'/);
  assert.match(watcher, /getAthenaReplyCredentials/);
  assert.match(watcher, /getMtmanDiscordId/);
  assert.match(watcher, /botAccessToken/);
  assert.match(watcher, /sayAsAthena/);
  assert.match(watcher, /generic watcher will not impersonate Athena/);
  assert.match(watcher, /Athena reply suppressed/);
  assert.match(watcher, /const athenaClient = athenaCredentials/);
});

test('MtFixIt monitor understands the ChatGPT review stage without using old deploy approval DM', () => {
  const orchestrator = source('src/lib/mtfixit-orchestrator.ts');
  assert.match(orchestrator, /resolution\.status === 'awaiting_chatgpt'/);
  assert.match(orchestrator, /outcome: 'waiting-review'/);
  assert.match(orchestrator, /continue;/);
});
