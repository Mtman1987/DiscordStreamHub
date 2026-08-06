import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMtFixItJobRequest,
  mtFixItPublicReply,
  parseMtFixItCommand,
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

test('public replies never expose job or engineering details', () => {
  assert.match(mtFixItPublicReply('accepted'), /owner/i);
  assert.doesNotMatch(mtFixItPublicReply('accepted'), /mtfix_/i);
  assert.match(mtFixItPublicReply('usage'), /!mtfixit/i);
  assert.match(mtFixItPublicReply('failed'), /could not accept/i);
});
