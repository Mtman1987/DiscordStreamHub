
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';
import { getDiscordClientId } from '@/lib/runtime-config';
import { botAccountGuilds } from '@/lib/discord-bot-server-discovery';
import { guildAccess, botInstallUrl } from '@/lib/discord-server-permissions';

export class ServerConnectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function serverAccount(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) throw new ServerConnectionError('Sign in with SPMT to connect your Discord servers.', 401);
  const resolved = await resolveSpmtSession(token).catch(() => null);
  if (!resolved?.session.spmtUserId) throw new ServerConnectionError('Your SPMT session expired. Sign in again.', 401);
  return resolved.session;
}
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin !== request.nextUrl.origin) throw new ServerConnectionError('Invalid request origin.', 403);
}
export async function discordApi(path: string, authorization: string) {
  const response = await fetch('https://discord.com/api/v10' + path, {
    headers: { Authorization: authorization }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ServerConnectionError(
    response.status === 401 ? 'Reconnect Discord to refresh server access.' :
    response.status === 403 || response.status === 404 ? 'SPMT cannot access this server yet. Complete the bot installation first.' :
    'Discord is temporarily unavailable. Try again.', response.status === 401 ? 409 : 503);
  return response.json();
}
export async function accountGuilds(accountId: string, linkedDiscordUserId = '') {
  // SPMT's verified linked identity is authoritative. Existing OAuth records
  // may identify older accounts, but no fresh guilds OAuth grant is required.
  const saved = db.get('discordServerOAuth', accountId);
  const discordUserId = linkedDiscordUserId || String(saved?.discordUserId || '');
  if (!/^\d{17,20}$/.test(discordUserId)) throw new ServerConnectionError('Link your Discord account in SPMT settings to identify your servers.', 409);
  try { return await botAccountGuilds(discordUserId, process.env.DISCORD_BOT_TOKEN || ''); }
  catch (error) { throw new ServerConnectionError(error instanceof Error ? error.message : 'Discord lookup failed.', 503); }
}
export async function discoveredServers(accountId: string, linkedDiscordUserId = '') {
  const { guilds } = await accountGuilds(accountId, linkedDiscordUserId);
  for (const guild of guilds) db.set('servers', guild.id, {
    serverId: guild.id, serverName: guild.name, name: guild.name, botInstalled: true,
    iconUrl: guild.icon ? 'https://cdn.discordapp.com/icons/' + guild.id + '/' + guild.icon + '.png' : '',
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  const selected = db.get('discordServerConnections', accountId)?.selectedServerId || '';
  return guilds.filter((guild: any) => guildAccess(guild).canManage).map((guild: any) => ({
    id: guild.id, name: guild.name, owner: !!guild.owner,
    iconUrl: guild.icon ? 'https://cdn.discordapp.com/icons/' + guild.id + '/' + guild.icon + '.png' : '',
    ...guildAccess(guild), botInstalled: true, selected: selected === guild.id,
    installUrl: guildAccess(guild).canInstall ? botInstallUrl(getDiscordClientId(), guild.id) : null,
  }));
}
