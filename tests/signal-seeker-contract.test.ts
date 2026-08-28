import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/lib/signal-seeker-service.ts', 'utf8');
const ingress = fs.readFileSync('src/app/api/discord/gateway-ingress/route.ts', 'utf8');
const interactions = fs.readFileSync('src/app/api/discord/interactions/route.ts', 'utf8');
const drop = fs.readFileSync('src/app/api/internal/signal/drop/route.ts', 'utf8');

test('DSH owns the Signal Seeker role and exact bare command', () => {
  assert.match(service, /ROLE_NAME = 'Signal Seeker'/);
  assert.match(service, /Join the Egg Hunt/);
  assert.match(service, /Leave the Hunt/);
  assert.match(ingress, /\^!signal\\s\*\$/);
  assert.match(ingress, /postSignalSeekerPanel/);
  assert.match(interactions, /signal_seekers:/);
});

test('random Signal drops ping only the opt-in role', () => {
  assert.match(drop, /ensureSignalSeekerRole/);
  assert.match(drop, /<@&\$\{signalSeekerRoleId\}>/);
  assert.match(drop, /roles: signalSeekerRoleId \? \[signalSeekerRoleId\] : \[\]/);
});

test('Signal win response explains the unlocked reward', () => {
  assert.match(interactions, /Your reward is `!signal <message>`/);
  assert.match(interactions, /No app sign-in required/);
});
