import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCORD_INGRESS_COMMAND_TIMEOUT_MS,
  DISCORD_INGRESS_PASSIVE_TIMEOUT_MS,
  getDiscordIngressTimeoutMs,
} from '../src/lib/discord-ingress-timeout';

test('ordinary passive Discord chat keeps the short ingress timeout', () => {
  assert.equal(getDiscordIngressTimeoutMs('hello everyone'), DISCORD_INGRESS_PASSIVE_TIMEOUT_MS);
});

test('SPMT and bang commands can outlive the 45 second downstream command route', () => {
  assert.ok(DISCORD_INGRESS_COMMAND_TIMEOUT_MS > 45_000);
  assert.equal(getDiscordIngressTimeoutMs('spmt status'), DISCORD_INGRESS_COMMAND_TIMEOUT_MS);
  assert.equal(getDiscordIngressTimeoutMs('@spmt live'), DISCORD_INGRESS_COMMAND_TIMEOUT_MS);
  assert.equal(getDiscordIngressTimeoutMs('!points'), DISCORD_INGRESS_COMMAND_TIMEOUT_MS);
});

test('an actual bot mention gets command timeout even before text normalization', () => {
  assert.equal(getDiscordIngressTimeoutMs('<@12345> points', true), DISCORD_INGRESS_COMMAND_TIMEOUT_MS);
});
