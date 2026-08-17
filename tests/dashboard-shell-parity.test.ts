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
  assert.match(text, /eventDate\.getTime\(\) < now/);
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

test('shared DSH workspace tray consumes canonical surfaces and never rebuilds overlay widgets', () => {
  const text = source('src/components/spmt-workspace-host.tsx');
  const personal = source('src/components/personal-overlay-host.tsx');
  const bridge = source('src/app/api/spmt/workspace-theme/route.ts');

  assert.match(text, /spmt:workspace-state/);
  assert.match(text, /aria-label="Collapse workspace into ecosystem header"/);
  assert.match(text, /\/login\?next=/);
  assert.match(text, /Reconnect SPMT workspace/);
  assert.match(text, /surfaceUrls/);
  assert.match(text, /Personal(?: overlay)? \{personalOverlayVisible \? 'On' : 'Off'\}/);
  assert.match(text, /spmt:personal-overlay-visibility/);
  assert.doesNotMatch(text, /tokens\?\.overlayWorkspace/);
  assert.doesNotMatch(text, /widget\.x/);
  assert.doesNotMatch(text, /widget\.url/);
  assert.doesNotMatch(text, /spacemountain\.live/);
  assert.doesNotMatch(text, /if \(hiddenRoute \|\| embedded \|\| !connected\) return null/);

  assert.match(personal, /data-canonical-personal-overlay="true"/);
  assert.match(personal, /data-personal-overlay-scene="true"/);
  assert.match(personal, /discord-stream-hub:personal-overlay-visible/);
  assert.match(personal, /spmt:personal-overlay-visibility/);
  assert.match(personal, /\/api\/spmt\/personal-overlay/);
  assert.doesNotMatch(personal, /personalOverlayUrl/);
  assert.doesNotMatch(personal, /<iframe[^>]+data-canonical-personal-overlay/);

  assert.match(bridge, /\/api\/platform\/surfaces/);
  assert.match(bridge, /\/api\/personal-overlay-launch/);
  assert.match(bridge, /\/api\/tenant-scene\?output=public/);
  assert.match(bridge, /surfaceUrls:/);
});

test('Personal overlay opacity only affects transparent local scene assets', () => {
  const control = source('src/components/personal-overlay-opacity-control.tsx');
  assert.match(control, /data-personal-overlay-scene/);
  assert.match(control, /scene\.style\.opacity\s*=/);
  assert.match(control, /setProperty\('background', 'transparent', 'important'\)/);
  assert.doesNotMatch(control, /iframe\[data-canonical-personal-overlay/);
  assert.doesNotMatch(control, /spmt\.personal\.local-opacity/);
});

test('dashboard exposes compact primary community operations instead of a weak app-links card', () => {
  const text = source('src/app/(app)/dashboard/page.tsx');
  assert.match(text, /Community Command Center/);
  assert.match(text, /repeat\(auto-fit,minmax\(190px,1fr\)\)/);
  assert.match(text, /line-clamp-2/);
  for (const route of ['/shoutouts', '/calendar', '/leaderboard', '/messages', '/applications']) {
    assert.match(text, new RegExp(route.replace('/', '\\/')));
  }
  assert.doesNotMatch(text, /DiscordStreamHub Apps/);
});

test('DSH sidebar keeps one account control and clears the shared Worktray', () => {
  const text = source('src/app/(app)/layout.tsx');
  assert.match(text, /<UserNav \/>/);
  assert.match(text, /SidebarFooter className="px-4 pb-20 pt-4"/);
  assert.match(text, /\[scrollbar-width:none\]/);
  assert.doesNotMatch(text, /For the Space Mountain Admin/);
  assert.doesNotMatch(text, /powered by Mtman1987/);
  assert.doesNotMatch(text, /<SidebarSeparator/);
});
