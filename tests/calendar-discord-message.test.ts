import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { partitionCalendarMessages, upsertCalendarMessage } from '../src/lib/calendar-message-state';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

test('calendar message state keeps one current message per channel and identifies stale posts', () => {
  const oldMessage = { channelId: 'calendar', messageId: 'old', monthOffset: 0 };
  const latestMessage = { channelId: 'calendar', messageId: 'latest', monthOffset: 1 };
  const otherChannel = { channelId: 'events', messageId: 'events-current', monthOffset: 0 };
  const result = partitionCalendarMessages([oldMessage, otherChannel, latestMessage]);

  assert.deepEqual(result.current, [latestMessage, otherChannel]);
  assert.deepEqual(result.superseded, [oldMessage]);
  assert.deepEqual(upsertCalendarMessage([oldMessage, otherChannel], latestMessage), [otherChannel, latestMessage]);
});

test('calendar refresh and publish each send one image embed and explicitly replace the attachment', () => {
  const service = source('src/lib/calendar-discord-service-new.ts');
  assert.match(service, /image:\s*\{\s*url:\s*'attachment:\/\/calendar\.png'/);
  assert.match(service, /embeds:\s*\[embed\]/);
  assert.match(service, /attachments:\s*\[\{\s*id:\s*0,\s*filename:\s*'calendar\.png'/);
  assert.doesNotMatch(service, /buildMissionLogEmbed|🌌 Mission Log/);
  assert.match(service, /sendCalendarMessage\(\s*'PATCH'/);
  assert.match(service, /sendCalendarMessage\(\s*'POST'/);
});

test('publishing to a channel updates its tracked calendar instead of posting a duplicate', () => {
  const service = source('src/lib/calendar-discord-service-new.ts');
  assert.match(service, /const existing = calendars\.find\(\(meta\) => meta\.channelId === channelId\)/);
  assert.match(service, /if \(existing\)[\s\S]*?sendCalendarMessage\('PATCH'[\s\S]*?if \(response\.status === 404\)[\s\S]*?sendCalendarMessage\('POST'/);
  assert.match(service, /deleteSupersededMessages\(botToken, superseded\)/);
  assert.match(service, /method: 'DELETE'/);
});

test('admin mutations, refresh API, and legacy publisher all use the canonical calendar service', () => {
  const admin = source('src/lib/calendar-admin-actions.ts');
  const refreshRoute = source('src/app/api/calendar/refresh/route.ts');
  const generateRoute = source('src/app/api/calendar/generate/route.ts');
  const legacy = source('src/lib/calendar-discord-service.ts');

  assert.match(admin, /calendar-discord-service-new/);
  assert.match(refreshRoute, /calendar-discord-service-new/);
  assert.match(generateRoute, /postCalendarToDiscord\(serverId, channelId, 0, includeButtons\)/);
  assert.doesNotMatch(generateRoute, /missionEmbed|embeds:\s*\[mission/);
  assert.match(legacy, /postCalendarToDiscord\(serverId, channelId, 0, true\)/);
  assert.doesNotMatch(legacy, /buildMissionLogEmbed|calendarMessages\s*=\s*\[\.\.\.existing/);
});
