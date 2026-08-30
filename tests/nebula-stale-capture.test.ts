import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('changed Nebula revisions are removed from rotation before recapture', () => {
  const needed = read('src/app/api/clips/nebula/needed/route.ts');
  assert.match(needed, /staleIds/);
  assert.match(needed, /deleteNebulaGameplayCapture/);
  assert.match(needed, /saved\.revision !== game\.revision/);
  assert.match(needed, /removedStaleGames/);
  assert.match(needed, /NEBULA_CAPTURE_BATCH_SIZE = 1/);
});

test('stale capture deletion removes both GIF and metadata without touching unchanged games', () => {
  const rotation = read('src/lib/nebula-gameplay-rotation.ts');
  assert.match(rotation, /export async function deleteNebulaGameplayCapture/);
  assert.match(rotation, /`\$\{id\}\.gif`/);
  assert.match(rotation, /`\$\{id\}\.gif\.meta\.json`/);
  assert.match(rotation, /unlink/);
});
