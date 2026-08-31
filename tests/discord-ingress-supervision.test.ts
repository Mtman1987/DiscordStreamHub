import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const start = readFileSync(new URL('../scripts/start.sh', import.meta.url), 'utf8');

test('Discord ingress is supervised and automatically restarted', () => {
  assert.match(start, /while true; do/);
  assert.match(start, /npm run discord-ingress-bot/);
  assert.match(start, /Discord ingress bot exited with code \$CODE; restarting in 10s/);
});

test('Next remains PID 1 while ingress runs as a supervised child', () => {
  assert.match(start, /exec \.\/node_modules\/\.bin\/next start -H 0\.0\.0\.0 -p 3000/);
});
