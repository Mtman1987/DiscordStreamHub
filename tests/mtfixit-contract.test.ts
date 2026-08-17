import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMtFixItJobRequest,
  mtFixItPublicReply,
  parseMtFixItCommand,
  resolveTwitchMtFixItTenantId,
} from '../src/lib/mtfixit-contract';

test('parses mtfixit case-insensitively and preserves the report', () => {
  assert.equal(parseMtFixItCommand('!mtfixit leaderboard image timed out'), 'leaderboard image timed out');
  assert.equal(parseMtFixItCommand('  !MTFIXIT   Discord relay returned 404  '), 'Discord relay returned 404');
  assert.equal(parseMtFixItCommand('!athena hello'), null);
});

test('distinguishes a missing description from a non-mtfixit message', () => {
  assert.equal(parseMtFixItCommand('!mtfixit'), '');
  assert.equal(parseMtFixItCommand('!mtfixit   '), '');
  assert.equal(parseMtFixItCommand('hello !mtfixit'), null);
});

test('resolves Twitch mtfixit tenant from broadcaster room-id before linked fallback', () => {
  assert.equal(resolveTwitchMtFixItTenantId('123456789', '987654321'), '123456789');
  assert.equal(resolveTwitchMtFixItTenantId(undefined, '987654321'), '987654321');
  assert.equal(resolveTwitchMtFixItTenantId('not-a-twitch-id', '987654321'), '987654321');
  assert.equal(resolveTwitchMtFixItTenantId('not-a-twitch-id', 'also-bad'), undefined);
});

test('builds a DSH-owned rotator request without publication authority', () => {
  const request = buildMtFixItJobRequest({
    source: 'discord',
    reporter: 'Crew Member',
    reporterId: 'discord-123',
    tenantId: 'guild-1',
    channelId: 'channel-2',
    channelName: 'support',
    guildId: 'guild-1',
    messageId: 'message-3',
    description: 'The leaderboard image generator timed out.',
  });
  assert.equal(request.source, 'dsh:discord');
  assert.equal(request.reporterId, 'discord-123');
  assert.equal(request.description, 'The leaderboard image generator timed out.');
  assert.deepEqual(request.context, {
    source: 'discord',
    channelId: 'channel-2',
    channelName: 'support',
    guildId: 'guild-1',
    messageId: 'message-3',
  });
  assert.equal('publish' in request, false);
});

test('public replies use Athena and mtman without exposing engineering internals', () => {
  for (const outcome of ['accepted', 'analysis', 'escalated', 'failed'] as const) {
    const reply = mtFixItPublicReply(outcome);
    assert.match(reply, /Athena/i);
    assert.doesNotMatch(reply, /Athena\s+Coder/i);
    assert.doesNotMatch(reply, /\bowner\b/i);
    assert.doesNotMatch(reply, /mtfix_[a-z0-9_-]+/i);
  }
  assert.match(mtFixItPublicReply('accepted'), /mtman/i);
  assert.match(mtFixItPublicReply('analysis'), /mtman/i);
  assert.match(mtFixItPublicReply('escalated'), /mtman/i);
  assert.match(mtFixItPublicReply('usage'), /!mtfixit/i);
  assert.doesNotMatch(mtFixItPublicReply('failed'), /exception|token|secret|http\s+\d+/i);
});
