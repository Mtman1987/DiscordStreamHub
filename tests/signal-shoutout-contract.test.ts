import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const patch = fs.readFileSync(path.join(root, 'scripts/patch-signal-shoutout.mjs'), 'utf8');
const control = fs.readFileSync(path.join(root, 'src/lib/signal-shoutout-control.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/app/signal/remove/page.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/app/signal/remove/signal-remove-client.tsx'), 'utf8');

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

test('Signal shoutout trash control is an inline embed link rather than an external Discord button', () => {
  assert.match(patch, /buildSignalShoutoutControlField/);
  assert.doesNotMatch(patch, /label: 'Remove Signal'/);
  assert.doesNotMatch(patch, /signal_shoutout_delete:/);
  assert.match(control, /value: `\[🗑️\]/);
  assert.match(control, /SIGNAL_CONTROL_PATH = '\/signal\/remove'/);
  assert.match(page, /SignalRemoveClient/);
  assert.match(client, /Tap the trash can to confirm/);
});

test('Signal web control suppresses the saved rotation before deleting the Discord message', () => {
  assert.match(patch, /suppressedAt/);
  assert.match(patch, /if \(entry\.suppressedAt\) continue/);
  assert.match(patch, /currentRecord\.data\(\)\?\.suppressedAt/);
  assert.match(control, /suppressedAt: nowIso/);
  assert.match(control, /trackWhileLive: false/);
  assert.match(control, /deleteDiscordMessage/);
});

test('Signal trash authorization uses the signed-in requester identity or DSH admin flag', () => {
  assert.match(control, /resolved\.session\.isAdmin/);
  assert.match(control, /sessionMatchesRequester/);
  assert.match(control, /requesterDiscordId/);
  assert.match(control, /twitchUsername/);
  assert.match(control, /approved DSH administrator/);
});
