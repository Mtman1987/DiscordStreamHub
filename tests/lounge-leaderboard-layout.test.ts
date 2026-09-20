import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Lounge leaderboard favors five large readable rows', () => {
  const source = fs.readFileSync('src/app/headless/leaderboard/[serverId]/page-client.tsx', 'utf8');
  assert.match(source, /w-\[720px\]/);
  assert.match(source, /leaderboard\.slice\(0, 5\)/);
  assert.match(source, /h-\[88px\] w-\[88px\]/);
  assert.match(source, /text-4xl font-black/);
  assert.doesNotMatch(source, /Join \{branding\.serverName\} to climb the ranks/);
});
