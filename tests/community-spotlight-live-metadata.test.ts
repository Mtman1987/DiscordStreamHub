import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('community spotlight hydrates every live user with current Twitch metadata', () => {
  const route = fs.readFileSync('src/app/api/community-spotlight/route.ts', 'utf8');
  assert.match(route, /getStreamsByLogins/);
  assert.match(route, /const candidates = usersSnap\.docs\.map\(mapUser\)/);
  assert.match(route, /const liveByLogin = logins\.length \? await getStreamsByLogins\(logins\)/);
  assert.match(route, /if \(!stream\) return null/);
  assert.match(route, /gameName: stream\.game_name \|\| null/);
  assert.match(route, /viewerCount: Number\.isFinite\(Number\(stream\.viewer_count\)\)/);
  assert.match(route, /spotlightUser\.gameName \|\| spotlightData\.gameTitle/);
  assert.match(route, /spotlightUser\.viewerCount \?\? spotlightData\.viewerCount/);
});
