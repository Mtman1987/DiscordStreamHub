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

test('application decisions and manual shoutouts reuse canonical services', () => {
  const service = source('src/lib/bot-action-service.ts');
  const decisionRoute = source('src/app/api/applications/decision/route.ts');
  const notifyRoute = source('src/app/api/applications/notify/route.ts');
  assert.match(service, /decideApplication\(/);
  assert.match(service, /notifyApplicationDecision\(/);
  assert.match(service, /registerManualDiscordShoutout\(/);
  assert.match(service, /isApplicationOwner\(serverId, actorUserId\)/);
  assert.match(decisionRoute, /decideApplication\(/);
  assert.match(notifyRoute, /notifyApplicationDecision\(/);
});

test('application decisions are owner-only and notify after the saved decision', () => {
  const service = source('src/lib/bot-action-service.ts');
  const ownerIndex = service.indexOf('isApplicationOwner(serverId, actorUserId)');
  const decideIndex = service.indexOf('const decided = await decideApplication');
  const notifyIndex = service.indexOf('const notification = await notifyApplicationDecision');
  assert.ok(ownerIndex >= 0 && decideIndex > ownerIndex && notifyIndex > decideIndex);
  assert.match(service, /'dsh\.applications\.decide'/);
  assert.match(service, /'dsh\.shoutouts\.post'/);
});

test('application decision notifications are replay-safe', () => {
  const service = source('src/lib/application-admin-actions.ts');
  assert.match(service, /notificationStatus === 'delivered'/);
  assert.match(service, /duplicate: true/);
  assert.match(service, /notificationMessageId/);
});
