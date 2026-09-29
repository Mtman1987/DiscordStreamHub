import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/lib/signal-seeker-service.ts', 'utf8');
const ingress = fs.readFileSync('src/app/api/discord/gateway-ingress/route.ts', 'utf8');
const interactions = fs.readFileSync('src/app/api/discord/interactions/route.ts', 'utf8');
const drop = fs.readFileSync('src/app/api/internal/signal/drop/route.ts', 'utf8');
const buildPatch = fs.readFileSync('scripts/patch-signal-shoutout.mjs', 'utf8');

test('bare Discord !signal posts both Signal Seeker controls and one Signal', () => {
  assert.match(service, /ROLE_NAME = 'Signal Seeker'/);
  assert.match(service, /Join the Egg Hunt/);
  assert.match(service, /Leave the Hunt/);
  assert.match(ingress, /\^!signal\\s\*\$/);
  assert.match(ingress, /postSignalSeekerPanel/);
  assert.match(ingress, /postCommandSignalDrop/);
  assert.match(ingress, /signalDrop:/);
  assert.match(interactions, /signal_seekers:/);
});

test('command-created Signal pings only the opt-in role', () => {
  assert.match(service, /postCommandSignalDrop/);
  assert.match(service, /<@&\$\{roleId\}> a Signal is ready to open/);
  assert.match(service, /roles: roleId \? \[roleId\] : \[\]/);
  assert.match(drop, /postSignalDrop/);
});

test('Signal drops delete and stop opening after ten minutes', () => {
  assert.match(service, /SIGNAL_DROP_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(service, /method: 'DELETE'/);
  assert.match(service, /expiresAt/);
  assert.match(interactions, /Signal faded after 10 minutes/);
});

test('Signal button opens the clue without an identity lookup or egg roll', () => {
  const start = interactions.indexOf("if (customId.startsWith('signal_intercept:'))");
  const end = interactions.indexOf("if (customId.startsWith('sw_pokemon_trade_'))", start);
  const handler = interactions.slice(start, end);
  assert.match(service, /label: 'OPEN SIGNAL'/);
  assert.match(handler, /SIGNAL OPENED/);
  assert.match(handler, /opens:/);
  assert.doesNotMatch(handler, /claimDiscordSignalEgg/);
  assert.doesNotMatch(handler, /grandfatherDiscordIdentity/);
  assert.doesNotMatch(handler, /SIGNAL EGG ACQUIRED/);
  assert.match(buildPatch, /source\.includes\('\*\*SIGNAL OPENED\*\*'\)/);
});
