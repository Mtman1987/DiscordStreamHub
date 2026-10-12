
export function guildAccess(guild: { owner?: boolean; permissions?: string }) {
  let permissions = BigInt('0');
  try { permissions = BigInt(guild.permissions || '0'); } catch {}
  const canInstall = guild.owner === true || (permissions & (BigInt('8') | BigInt('32'))) !== BigInt('0');
  const canManage = canInstall || (permissions & (BigInt('2') | BigInt('4') | BigInt('8192') | BigInt('268435456') | BigInt('1099511627776'))) !== BigInt('0');
  return { canManage, canInstall };
}
export function botInstallUrl(clientId: string, guildId?: string) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: clientId, scope: 'bot applications.commands', integration_type: '0',
    // View/send messages, embeds, attachments, history, reactions, connect/speak.
    permissions: (BigInt('3263552') | (BigInt(1) << BigInt(13)) | (BigInt(1) << BigInt(34)) | (BigInt(1) << BigInt(35)) | (BigInt(1) << BigInt(38))).toString(),
  }).toString();
  if (guildId) { url.searchParams.set('guild_id', guildId); url.searchParams.set('disable_guild_select', 'true'); }
  return url.toString();
}
