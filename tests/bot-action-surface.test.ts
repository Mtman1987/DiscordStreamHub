import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

test('the internal bot surface authenticates before executing app actions', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  const authIndex = route.indexOf('hasAuthorizedBearerToken');
  const executeIndex = route.indexOf('executeDshBotAction({');
  assert.ok(authIndex >= 0);
  assert.ok(executeIndex > authIndex);
  assert.match(route, /getServiceToServiceSecrets\(\)/);
});

test('the DSH adapter calls the same canonical functions as the UI buttons', () => {
  const service = source('src/lib/bot-action-service.ts');
  assert.match(service, /submitCaptainLog\(/);
  assert.match(service, /submitMission\(/);
  assert.match(service, /postCalendarToDiscord\(/);
  assert.match(service, /refreshCalendarMessage\(/);
  assert.match(service, /publicApplicationEmbed\(/);
});

test('broadcast actions resolve named Discord channels and require confirmed API success', () => {
  const service = source('src/lib/bot-action-service.ts');
  assert.match(service, /resolveDiscordChannel\(serverId/);
  assert.match(service, /if \(!response\.ok\)/);
  assert.match(service, /Discord rejected the application embed/);
  assert.match(service, /postCalendarToDiscord\(serverId, channel\.id/);
});

test('UI application posting requires an owner session before reusing the bot action adapter', () => {
  const route = source('src/app/api/applications/post-embed/route.ts');
  const authIndex = route.indexOf('resolveSpmtSession(sessionToken)');
  const ownerIndex = route.indexOf('isOwner(String(serverId), userId)');
  const postIndex = route.indexOf('postApplicationEmbed(serverId, channelId)');
  assert.ok(authIndex >= 0);
  assert.ok(ownerIndex > authIndex);
  assert.ok(postIndex > ownerIndex);
  assert.match(route, /postApplicationEmbed/);
  assert.doesNotMatch(route, /discord\.com\/api\/v10/);
});

test('write and broadcast actions persist idempotency receipts', () => {
  const service = source('src/lib/bot-action-service.ts');
  assert.match(service, /botActionReceipts/);
  assert.match(service, /withIdempotencyReceipt\(input/);
  assert.match(service, /duplicate: true/);
});
