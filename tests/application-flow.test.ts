import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPLICATION_DEFINITIONS,
  APPLICATION_SUPPORT_FOOTER,
  buildApplicationModal,
  buildInquiryMessage,
  parseApplicationType,
} from '../src/lib/application-flow.ts';

test('supports moderator, partner, and developer DM apply aliases', () => {
  assert.equal(parseApplicationType('md'), 'mod');
  assert.equal(parseApplicationType('moderator'), 'mod');
  assert.equal(parseApplicationType('partnership'), 'partner');
  assert.equal(parseApplicationType('sdk'), 'dev');
});

test('builds five-question production application modals with tenant-bound IDs', () => {
  for (const type of ['mod', 'partner', 'dev'] as const) {
    const modal = buildApplicationModal(type, 'guild-123');
    assert.equal(modal.components.length, 5);
    assert.equal(modal.custom_id, `application_submit:${type}:guild-123`);
  }
});

test('inquiry DMs include exact support wording, terms, docs, and start control', () => {
  const payload = buildInquiryMessage('partner', 'guild-123');
  assert.equal(payload.embeds[0].footer.text, APPLICATION_SUPPORT_FOOTER);
  assert.match(JSON.stringify(payload), /Read Terms/);
  assert.match(JSON.stringify(payload), /SPMT Documentation/);
  assert.match(JSON.stringify(payload), /application_start:partner:guild-123/);
});

test('pins each role to its own versioned source document hash', () => {
  const hashes = Object.values(APPLICATION_DEFINITIONS).map(item => item.termsHash);
  assert.equal(new Set(hashes).size, 3);
  hashes.forEach(hash => assert.match(hash, /^[a-f0-9]{64}$/));
});

test('keeps Discord component copy inside platform limits', () => {
  for (const type of ['mod', 'partner', 'dev'] as const) {
    const modal = buildApplicationModal(type, '1240832965865635881');
    assert.ok(modal.title.length <= 45);
    assert.ok(modal.custom_id.length <= 100);
    modal.components.forEach(row => {
      assert.ok(row.components[0].label.length <= 45);
      assert.ok(row.components[0].placeholder.length <= 100);
    });
  }
});
