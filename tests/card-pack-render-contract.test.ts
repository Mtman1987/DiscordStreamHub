import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('card pack renders are idempotent jobs stored by event id', async () => {
  const source = await read('src/lib/card-pack-render-jobs.ts');
  assert.match(source, /const id = eventId/);
  assert.match(source, /if \(existing\.exists\) return existing\.data\(\)/);
  assert.match(source, /status: 'pending'/);
  assert.match(source, /attempts >= 3 \? 'failed' : 'pending'/);
});

test('clip worker records shared pack renderer and stores a persistent gif', async () => {
  const worker = await read('clip-worker/card-pack-render-worker.js');
  const dockerfile = await read('clip-worker/Dockerfile');
  const complete = await read('src/app/api/internal/card-pack/render/complete/route.ts');
  assert.match(worker, /DURATION_SECONDS = 14/);
  assert.match(worker, /page\.goto\(job\.renderUrl/);
  assert.match(worker, /api\/internal\/card-pack\/render\/complete/);
  assert.match(dockerfile, /node card-pack-render-worker\.js & exec node worker\.js/);
  assert.match(complete, /card-pack-reveals/);
});

test('card pack media remains publicly readable through the safe media root', async () => {
  const media = await read('src/app/api/media/[...path]/route.ts');
  assert.match(media, /filePath\.startsWith\(`\$\{storageRoot\}\$\{sep\}`\)/);
  assert.match(media, /'image\/gif'/);
});
