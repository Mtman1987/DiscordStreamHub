import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('internal Twitch continuity probe is service-authenticated and uses strict lookup', () => {
  const route = source('src/app/api/internal/twitch/live-status/route.ts');
  const twitch = source('src/lib/twitch-api-service.ts');
  assert.match(route, /SPMT_API_KEY/);
  assert.match(route, /authorization/);
  assert.match(route, /getStreamByLoginStrict/);
  assert.match(route, /status: 502/);
  assert.match(route, /cache-control/);
  assert.match(twitch, /async getStreamByLoginStrict/);
  assert.match(twitch, /encodeURIComponent\(normalized\)/);
});
