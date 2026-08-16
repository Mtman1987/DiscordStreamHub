import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildTwitchBanOwnerDm, isTwitchBanNotice } from '../src/lib/twitch-ban-blacklist';

test('recognizes Twitch permanent-ban notices without matching unrelated notices', () => {
  assert.equal(isTwitchBanNotice('msg_banned', 'ignored'), true);
  assert.equal(isTwitchBanNotice('msg_channel_suspended', 'channel suspended'), false);
  assert.equal(isTwitchBanNotice('', 'You are permanently banned from talking in this channel.'), true);
});

test('owner DM includes durable and monthly player facts', () => {
  const message = buildTwitchBanOwnerDm({
    channel: 'mountaineer',
    displayName: 'Mountaineer',
    twitchId: '123',
    discordUserId: '456',
    chatTagJoinedAt: '2026-08-01T00:00:00Z',
    discordJoinedAt: '2026-07-01T00:00:00Z',
    daysPlayed: 4,
    tags: 9,
    tagged: 3,
    lastPlayedAt: '2026-08-15T00:00:00Z',
  }, new Date('2026-08-16T00:00:00Z'));

  assert.match(message, /Known\/playing for: 15 days/);
  assert.match(message, /Days played: 4/);
  assert.match(message, /Tags this month: 9/);
  assert.match(message, /Times tagged this month: 3/);
  assert.match(message, /will not automatically add this channel back/);
});

test('chat service persists and synchronizes a msg_banned blacklist before notifying once', () => {
  const service = readFileSync(
    new URL('../src/lib/twitch-chat-service.ts', import.meta.url),
    'utf8',
  );

  assert.match(service, /this\.client\.on\('notice'/);
  assert.match(service, /collection\('twitchChatBlacklist'\)/);
  assert.match(service, /blacklistInStreamweaver\(channel\)/);
  assert.match(service, /blacklistChatTagChannel\(channel\)/);
  assert.match(service, /!record\.notificationSentAt/);
  assert.match(service, /notificationSentAt: new Date\(\)\.toISOString\(\)/);
});
