import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNAL_DROP_TTL_MS, signalDropExpired, signalHuntClue, signalAlertPayload } from '../src/lib/signal-hunt';

test('a Signal accepts hunters for a full hour and expires at the boundary', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  const expiry = new Date(now + SIGNAL_DROP_TTL_MS).toISOString();
  assert.equal(SIGNAL_DROP_TTL_MS, 3_600_000);
  assert.equal(signalDropExpired(expiry, now + 59 * 60_000), false);
  assert.equal(signalDropExpired(expiry, now + 3_600_000), true);
  assert.equal(signalDropExpired('invalid', now), true);
});
test('repeat interception reveals both trails and then concrete instructions without a dead end', () => {
  const clues = Array.from({ length: 6 }, (_, index) => signalHuntClue(index));
  assert.equal(new Set(clues).size, 6);
  assert.match(clues[4], /Double-click or double-tap/);
  assert.match(clues[5], /three drifting objects/);
  assert.equal(signalHuntClue(6), clues[4]);
  assert.equal(signalHuntClue(7), clues[5]);
});
test('the dedicated alert is non-silent, mentions only the hunter role, and links to the exact source', () => {
  const payload = signalAlertPayload({ guildId: '123', channelId: '456', messageId: '789', roleId: '321', expiresAt: '2026-09-11T13:00:00Z' });
  assert.equal('flags' in payload, false);
  assert.deepEqual(payload.allowed_mentions, { parse: [], roles: ['321'] });
  assert.match(payload.content, /<@&321>/);
  assert.match(payload.embeds[0].description, /https:\/\/discord.com\/channels\/123\/456\/789/);
});
