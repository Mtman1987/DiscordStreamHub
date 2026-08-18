import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const patch = fs.readFileSync(path.join(root, 'scripts/patch-signal-shoutout.mjs'), 'utf8');

test('Signal reuses the manual shoutout lifecycle with a distinct kind', () => {
  assert.match(patch, /kind = body\.kind === 'signal' \? 'signal' : 'manual'/);
  assert.match(patch, /signalText/);
  assert.match(patch, /kind\?: 'manual' \| 'signal'/);
  assert.match(patch, /getExistingManualRecord[^]*kind: 'manual' \| 'signal'/);
});

test('Signal card keeps the existing media/live lifecycle but changes presentation', () => {
  assert.match(patch, /📡 INCOMING SIGNAL/);
  assert.match(patch, /LIVE CARRIER LOCKED/);
  assert.match(patch, /CARRIER LOCATED/);
  assert.match(patch, /Transmitted By/);
  assert.match(patch, /SpaceMountain Signal/);
  assert.match(patch, /entry\.signalText/);
});
