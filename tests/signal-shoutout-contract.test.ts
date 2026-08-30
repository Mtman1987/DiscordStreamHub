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

test('Signal shoutouts expose a trash control that removes the saved rotation record', () => {
  assert.match(patch, /label: 'Remove Signal'/);
  assert.match(patch, /signal_shoutout_delete:/);
  assert.match(patch, /removeSignalDiscordShoutout/);
  assert.match(patch, /suppressedAt/);
  assert.match(patch, /if \(entry\.suppressedAt\) continue/);
  assert.match(patch, /currentRecord\.data\(\)\?\.suppressedAt/);
});

test('Signal trash authorization allows the original requester or Discord moderators', () => {
  assert.match(patch, /requesterDiscordId === actorDiscordId/);
  assert.match(patch, /input\.isModerator/);
  assert.match(patch, /MANAGE_MESSAGES/);
  assert.match(patch, /MANAGE_GUILD/);
  assert.match(patch, /Only the person who sent this Signal or a moderator can remove it/);
});
