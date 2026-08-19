import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('linking embed remembers channel name and can self-heal deleted Discord channel IDs', () => {
  const dispatch = read('src/app/api/discord/dispatch-embed/route.ts');
  const patcher = read('scripts/patch-linking-channel-recovery.mjs');
  const pkg = read('package.json');

  assert.match(dispatch, /channelName/);
  assert.match(dispatch, /needsDispatch:\s*false/);

  assert.match(patcher, /getChannels/);
  assert.match(patcher, /savedChannelStillExists/);
  assert.match(patcher, /staleChannelDoc/);
  assert.match(patcher, /candidate\?\.name === effectiveChannelName/);
  assert.match(patcher, /effectiveChannelId = replacement\.id/);
  assert.match(patcher, /postDiscordMessage\(serverId, effectiveChannelId, payload\)/);
  assert.match(patcher, /staleChannelId:\s*channelId/);
  assert.match(patcher, /needsDispatch:\s*true/);
  assert.match(patcher, /messageId:\s*null/);
  assert.match(patcher, /channelId:\s*null/);

  assert.match(pkg, /patch:runtime-recovery/);
  assert.match(pkg, /patch-linking-channel-recovery\.mjs/);
});
