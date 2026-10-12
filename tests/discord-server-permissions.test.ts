import test from 'node:test';
import assert from 'node:assert/strict';
import { guildAccess, botInstallUrl } from '../src/lib/discord-server-permissions';
test('owners and server managers can install; moderators can select; members cannot', () => {
  assert.deepEqual(guildAccess({ owner: true }), { canManage: true, canInstall: true });
  assert.deepEqual(guildAccess({ permissions: '32' }), { canManage: true, canInstall: true });
  assert.deepEqual(guildAccess({ permissions: '8192' }), { canManage: true, canInstall: false });
  assert.deepEqual(guildAccess({ permissions: '1099511627776' }), { canManage: true, canInstall: false });
  assert.deepEqual(guildAccess({ permissions: '1024' }), { canManage: false, canInstall: false });
  assert.deepEqual(guildAccess({ permissions: 'invalid' }), { canManage: false, canInstall: false });
});
test('installation adds the bot to the exact server instead of commands-only or personal install', () => {
  const url = new URL(botInstallUrl('1279582181768957963', '1136132698746921110'));
  assert.equal(url.searchParams.get('guild_id'), '1136132698746921110');
  assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
  assert.equal(url.searchParams.get('integration_type'), '0');
  assert.equal(url.searchParams.get('disable_guild_select'), 'true');
  // One Administrator grant covers current and future ecosystem features.
  assert.equal(url.searchParams.get('permissions'), '8');
});