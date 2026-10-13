import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Twitch stream polling propagates API failures instead of reporting everyone offline', () => {
  const source = fs.readFileSync('src/lib/twitch-api-service.ts', 'utf8');
  const start = source.indexOf('async getStreamsByLogins(');
  const end = source.indexOf('\n  async getRandomClipFromOnlineUsers(', start);
  assert.notEqual(start, -1, 'getStreamsByLogins method exists');
  assert.notEqual(end, -1, 'method boundary exists');
  const method = source.slice(start, end);
  assert.match(method, /Error fetching streams by logins; preserving last known stream state/);
  assert.match(method, /catch \(error\)[\s\S]*?throw error;/);
  assert.doesNotMatch(method, /catch \(error\)[\s\S]*?return streamMap;/);
});
