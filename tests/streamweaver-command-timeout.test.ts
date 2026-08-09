import assert from 'node:assert/strict';
import test from 'node:test';
import { getStreamweaverCommandTimeoutMs } from '../src/lib/streamweaver-command-timeout';

test('allows image generation to finish without extending ordinary command timeouts', () => {
  assert.equal(getStreamweaverCommandTimeoutMs('!img four moonlit portraits'), 180_000);
  assert.equal(getStreamweaverCommandTimeoutMs('!IMG --count 4 station'), 180_000);
  assert.equal(getStreamweaverCommandTimeoutMs('!help'), 30_000);
  assert.equal(getStreamweaverCommandTimeoutMs('hello Athena'), 30_000);
});
