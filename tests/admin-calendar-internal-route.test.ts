import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('internal calendar writes require the shared service credential and reuse the canonical action', () => {
  const route = read('src/app/api/internal/calendar/add-mission/route.ts');
  assert.match(route, /hasAuthorizedBearerToken/);
  assert.match(route, /getServiceToServiceSecrets/);
  assert.match(route, /submitMission/);
  assert.match(route, /missionTimeZone/);
});

test('calendar actions preserve explicitly requested UTC times', () => {
  const actions = read('src/lib/calendar-admin-actions.ts');
  assert.match(actions, /Date\.UTC\(year, month - 1, day, hours, minutes/);
  assert.match(actions, /\['UTC', 'GMT', 'Z'\]\.includes/);
  assert.match(actions, /timeZone: String\(missionTimeZone/);
  assert.match(actions, /const dayKey = missionDate/);
});

test('Discord ingress forwards authoritative member permissions for calendar authorization', () => {
  const ingress = read('scripts/discord-ingress-bot.ts');
  assert.match(ingress, /PermissionFlagsBits\.Administrator/);
  assert.match(ingress, /message\.guild\?\.ownerId === message\.author\.id/);
  assert.match(ingress, /memberPermissions: memberPermissions\?\.bitfield\.toString/);
  assert.match(ingress, /isAdmin,/);
  assert.match(ingress, /isOwner,/);
});
