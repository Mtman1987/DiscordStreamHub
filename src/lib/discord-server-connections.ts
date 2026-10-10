
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';
import { getDiscordClientId } from '@/lib/runtime-config';
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
export async function accountGuilds(accountId: string) {
  const saved = db.get('discordServerOAuth', accountId);
  if (!saved?.access_token || !String(saved.scope || '').split(' ').includes('guilds')) {
    throw new ServerConnectionError('Connect Discord to find your servers.', 409);
  }
  let accessToken = saved.access_token;
  if (Number(saved.expires_at) < Date.now() + 60_000) {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh_token,
        client_id: getDiscordClientId(), client_secret: process.env.DISCORD_CLIENT_SECRET || '' }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new ServerConnectionError('Reconnect Discord to refresh server access.', 409);
    accessToken = data.access_token;
    db.set('discordServerOAuth', accountId, { ...saved, ...data, expires_at: Date.now() + data.expires_in * 1000 });
  }
  const guilds: any[] = [];
  let after = '';
  for (let page = 0; page < 20; page++) {
    const batch = await discordApi('/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''), 'Bearer ' + accessToken);
    guilds.push(...batch);
    if (batch.length < 200) break;
    after = batch[batch.length - 1].id;
  }
  return { discordUserId: String(saved.discordUserId), guilds };
}
export async function discoveredServers(accountId: string) {
  const { guilds } = await accountGuilds(accountId);
  const botGuilds = await discordApi('/users/@me/guilds?limit=200', 'Bot ' + (process.env.DISCORD_BOT_TOKEN || ''));
  const installed = new Set(botGuilds.map((g: any) => g.id));
  const selected = db.get('discordServerConnections', accountId)?.selectedServerId || '';
  return guilds.filter((guild: any) => guildAccess(guild).canManage).map((guild: any) => ({
    id: guild.id, name: guild.name, owner: !!guild.owner,
    iconUrl: guild.icon ? 'https://cdn.discordapp.com/icons/' + guild.id + '/' + guild.icon + '.png' : '',
    ...guildAccess(guild), botInstalled: installed.has(guild.id), selected: selected === guild.id,
    installUrl: guildAccess(guild).canInstall ? botInstallUrl(getDiscordClientId(), guild.id) : null,
  }));
}
