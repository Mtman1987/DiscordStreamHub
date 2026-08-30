import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NEBULA_GAMEPLAY_ROTATION_MS,
  getNebulaGameplaySlot,
  normalizeNebulaGameId,
  resolveNebulaGameplayNow,
  selectNebulaGameplay,
} from '../src/lib/nebula-gameplay-rotation';

test('Nebula gameplay advances exactly once per ten-minute slot', () => {
  const games = Array.from({ length: 20 }, (_, index) => `game-${index}`);
  assert.equal(selectNebulaGameplay(games, 0), 'game-0');
  assert.equal(selectNebulaGameplay(games, NEBULA_GAMEPLAY_ROTATION_MS - 1), 'game-0');
  assert.equal(selectNebulaGameplay(games, NEBULA_GAMEPLAY_ROTATION_MS), 'game-1');
  assert.equal(selectNebulaGameplay(games, NEBULA_GAMEPLAY_ROTATION_MS * 20), 'game-0');
  assert.equal(getNebulaGameplaySlot(NEBULA_GAMEPLAY_ROTATION_MS * 3), 3);
});

test('Nebula gameplay defaults to the current clock when slot is omitted', () => {
  const currentTime = NEBULA_GAMEPLAY_ROTATION_MS * 42 + 1234;
  assert.equal(resolveNebulaGameplayNow(null, currentTime), currentTime);
  assert.equal(resolveNebulaGameplayNow('', currentTime), currentTime);
  assert.equal(resolveNebulaGameplayNow('7', currentTime), NEBULA_GAMEPLAY_ROTATION_MS * 7);
  assert.equal(resolveNebulaGameplayNow('invalid', currentTime), currentTime);
});

test('Nebula game ids are safe volume file names', () => {
  assert.equal(normalizeNebulaGameId('../Chat Tag!'), 'chat-tag');
  assert.equal(normalizeNebulaGameId('Quackverse'), 'quackverse');
});

test('clip worker records 60-second gameplay and produces looping GIFs', () => {
  const worker = readFileSync(new URL('../clip-worker/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /durationSeconds \* NEBULA_CAPTURE_FPS/);
  assert.match(worker, /Math\.min\(60,/);
  assert.match(worker, /-loop 0/);
  assert.match(worker, /api\/clips\/nebula\/needed/);
});

test('existing streamer storage uses one canonical ten-GIF limit', () => {
  const upload = readFileSync(new URL('../src/app/api/clips/upload/route.ts', import.meta.url), 'utf8');
  const conversion = readFileSync(new URL('../src/lib/gif-conversion-service.ts', import.meta.url), 'utf8');
  assert.match(upload, /MAX_GIFS_PER_STREAMER = 10/);
  assert.match(conversion, /existingGifs\.length >= 10/);
});
