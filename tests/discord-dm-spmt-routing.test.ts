import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDiscordDmSpmtCommand,
  parseDiscordChatPayload,
} from '../src/lib/discord-chat-payload';

test('routes private SPMT status through Athena read-only intent handling', () => {
  const payload = normalizeDiscordDmSpmtCommand({
    userId: 'user-1',
    channelId: 'dm-1',
    isDM: true,
    message: 'spmt status',
  });

  assert.equal(payload.message, 'Athena, show me the Chat Tag status.');
  assert.equal(payload.content, 'Athena, show me the Chat Tag status.');
  assert.equal(payload.originalSpmtMessage, 'spmt status');
});

test('corrects common status typos before Athena intent routing', () => {
  const payload = parseDiscordChatPayload(JSON.stringify({
    root: {
      userId: 'user-1',
      channelId: 'dm-1',
      isDirectMessage: true,
      message: 'spmt sttus',
    },
  }));

  assert.equal(payload.root.message, 'Athena, show me the Chat Tag status.');
});

test('routes private live lookup through deterministic Athena wording', () => {
  const payload = normalizeDiscordDmSpmtCommand({
    userId: 'user-1',
    channelId: 'dm-1',
    channelType: 1,
    message: '@spmt live',
  });

  assert.equal(payload.message, 'Athena, how many Chat Tag users are live right now?');
});

test('converts other explicit private SPMT commands to the native command syntax', () => {
  const points = normalizeDiscordDmSpmtCommand({
    userId: 'user-1',
    channelId: 'dm-1',
    isDM: true,
    message: 'spmt points',
  });
  const pack = normalizeDiscordDmSpmtCommand({
    userId: 'user-1',
    channelId: 'dm-1',
    isDM: true,
    message: 'spmt !pack',
  });

  assert.equal(points.message, '!points');
  assert.equal(pack.message, '!pack');
});

test('does not rewrite ordinary private conversation', () => {
  const payload = normalizeDiscordDmSpmtCommand({
    userId: 'user-1',
    channelId: 'dm-1',
    isDM: true,
    message: 'Athena, how many users are reporting live in Chat-Tag?',
  });

  assert.equal(payload.message, 'Athena, how many users are reporting live in Chat-Tag?');
  assert.equal(payload.originalSpmtMessage, undefined);
});

test('does not change public-channel SPMT commands', () => {
  const payload = normalizeDiscordDmSpmtCommand({
    userId: 'user-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    channelType: 0,
    message: 'spmt status',
  });

  assert.equal(payload.message, 'spmt status');
  assert.equal(payload.originalSpmtMessage, undefined);
});
