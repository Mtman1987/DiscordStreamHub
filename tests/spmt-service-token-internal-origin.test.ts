import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

test('machine-to-machine OAuth and reward traffic bypasses the public custom-domain proxy', () => {
  const session = read('src/lib/spmt-session.ts');
  const tokens = read('src/lib/spmt-service-token.ts');
  const rewards = read('src/lib/voidwalker-reward-worker.ts');

  assert.match(session, /SPMT_INTERNAL_BASE_URL = String\(process\.env\.SPMT_INTERNAL_BASE_URL \|\| 'https:\/\/spmt-live\.fly\.dev'\)/);
  assert.match(tokens, /\$\{SPMT_INTERNAL_BASE_URL\}\/api\/oauth\/token/);
  assert.match(rewards, /\$\{SPMT_INTERNAL_BASE_URL\}\/api\/internal\/easter-eggs\/discord-rewards\/\$\{path\}/);
  assert.doesNotMatch(tokens, /\$\{SPMT_BASE_URL\}\/api\/oauth\/token/);
});
