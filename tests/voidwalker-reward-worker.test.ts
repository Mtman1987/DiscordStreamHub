import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/lib/voidwalker-reward-worker.ts'), 'utf8');

test('Voidwalker reward delivery retries expired identity tokens and transient SPMT failures', () => {
  assert.match(source, /SPMT_INTERNAL_BASE_URL/);
  assert.match(source, /SPMT_RETRY_DELAYS_MS = \[250, 750\]/);
  assert.match(source, /status === 401 \|\| status === 403 \|\| status === 429 \|\| status >= 500/);
  assert.match(source, /clearSpmtServiceTokenCache\(\)/);
  assert.match(source, /attempt <= SPMT_RETRY_DELAYS_MS\.length/);
  assert.match(source, /setTimeout\(resolve, SPMT_RETRY_DELAYS_MS\[attempt\]\)/);
});
