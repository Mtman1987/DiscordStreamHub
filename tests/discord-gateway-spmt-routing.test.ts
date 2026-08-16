import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePublicSpmtCommand } from '../src/app/api/discord/gateway-ingress/route';

test('routes public SPMT status through Athena status wording', () => {
  const command = normalizePublicSpmtCommand('spmt status');
  assert.equal(command?.controls, false);
  assert.equal(command?.forwardMessage, 'Athena, show me the Chat Tag status.');
});

test('corrects common public SPMT status typo', () => {
  assert.equal(
    normalizePublicSpmtCommand('spmt sttus')?.forwardMessage,
    'Athena, show me the Chat Tag status.',
  );
});

test('routes public live lookup through deterministic Athena wording', () => {
  assert.equal(
    normalizePublicSpmtCommand('@spmt live')?.forwardMessage,
    'Athena, how many Chat Tag users are live right now?',
  );
});

test('converts public SPMT commands to native command syntax exactly once', () => {
  assert.equal(normalizePublicSpmtCommand('spmt points')?.forwardMessage, '!points');
  assert.equal(normalizePublicSpmtCommand('spmt !pack')?.forwardMessage, '!pack');
});

test('recognizes the actual Discord bot mention as SPMT', () => {
  assert.equal(normalizePublicSpmtCommand('<@12345> points', '12345')?.forwardMessage, '!points');
  assert.equal(normalizePublicSpmtCommand('<@!12345> !pack', '12345')?.forwardMessage, '!pack');
});

test('keeps SPMT controls owned by DSH instead of forwarding twice', () => {
  const command = normalizePublicSpmtCommand('spmt controls');
  assert.equal(command?.controls, true);
  assert.equal(command?.forwardMessage, undefined);
});

test('does not classify ordinary Discord chat as an SPMT command', () => {
  assert.equal(normalizePublicSpmtCommand('hello everyone'), null);
});
