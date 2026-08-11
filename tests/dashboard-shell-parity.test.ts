import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('local data shim applies where constraints instead of silently ignoring them', () => {
  const text = source('src/lib/data-shim.ts');
  assert.match(text, /return \{ type: 'where', field, op, value \}/);
  assert.match(text, /ref\._where\.every/);
  assert.match(text, /applyQueryConstraints/);
  assert.doesNotMatch(text, /function where\([^)]*\)[\s\S]{0,120}return null/);
});

test('dashboard events keep a second future-only guard after query filtering', () => {
  const text = source('src/app/(app)/dashboard/_components/upcoming-events.tsx');
  assert.match(text, /where\('eventDateTime', '>=', new Date\(\)\)/);
  assert.match(text, /timestampToDate\(event\.eventDateTime\)/);
  assert.match(text, /eventDate\.getTime\(\) >= now/);
});

test('dashboard shoutout activity reads the live polling ledger', () => {
  const text = source('src/app/(app)/dashboard/_components/recent-shoutouts.tsx');
  assert.match(text, /'config', 'twitch-polling'/);
  assert.match(text, /lastShoutouts/);
  assert.doesNotMatch(text, /orderBy\('shoutoutGeneratedAt'/);
});

test('dashboard leaderboard resolves a deeper pool and shows five rows without dropping missing profiles', () => {
  const text = source('src/app/(app)/dashboard/_components/leaderboard-snapshot.tsx');
  assert.match(text, /limit\(15\)/);
  assert.match(text, /\.slice\(0, 5\)/);
  assert.match(text, /item\.user\?\.username \|\| item\.userProfileId/);
  assert.doesNotMatch(text, /filter\([^\n]*item\.user/);
});

test('shared DSH workspace tray remains visible and offers reconnection', () => {
  const text = source('src/components/spmt-workspace-host.tsx');
  assert.match(text, /aria-label="SPMT workspace tray"/);
  assert.match(text, /\/login\?next=/);
  assert.match(text, /Reconnect SPMT workspace/);
  assert.match(text, /left: `\$\{Number\(widget\.x \|\| 0\)\}%`/);
  assert.doesNotMatch(text, /if \(hiddenRoute \|\| embedded \|\| !connected\) return null/);
});

test('dashboard exposes the primary community operations instead of a weak app-links card', () => {
  const text = source('src/app/(app)/dashboard/page.tsx');
  assert.match(text, /Community Command Center/);
  for (const route of ['/shoutouts', '/calendar', '/leaderboard', '/messages', '/applications']) {
    assert.match(text, new RegExp(route.replace('/', '\\/')));
  }
  assert.doesNotMatch(text, /DiscordStreamHub Apps/);
});
