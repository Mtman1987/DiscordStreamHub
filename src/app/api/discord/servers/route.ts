
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serverAccount, sameOrigin, accountGuilds, discoveredServers, discordApi, ServerConnectionError } from '@/lib/discord-server-connections';
import { guildAccess } from '@/lib/discord-server-permissions';
export const dynamic = 'force-dynamic';
function failed(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Discord servers.',
    needsDiscordConnect: error instanceof ServerConnectionError && error.status === 409 },
    { status: error instanceof ServerConnectionError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(request: NextRequest) {
  try {
    const session = await serverAccount(request);
    return NextResponse.json({ servers: await discoveredServers(session.spmtUserId!, session.discordUserId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failed(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const session = await serverAccount(request);
    const { guildId } = await request.json();
    if (!/^\d{17,20}$/.test(String(guildId || ''))) throw new ServerConnectionError('Select a valid Discord server.');
    const { guilds, discordUserId } = await accountGuilds(session.spmtUserId!, session.discordUserId);
    const selected = guilds.find(guild => guild.id === guildId);
    if (!selected || !guildAccess(selected).canManage) throw new ServerConnectionError('You do not have management access to this Discord server.', 403);
    const auth = 'Bot ' + (process.env.DISCORD_BOT_TOKEN || '');
    const [guild, member, roles, channels] = await Promise.all([
      discordApi('/guilds/' + guildId, auth),
      discordApi('/guilds/' + guildId + '/members/' + discordUserId, auth),
      discordApi('/guilds/' + guildId + '/roles', auth),
      discordApi('/guilds/' + guildId + '/channels', auth),
    ]);
    const iconUrl = selected.icon ? 'https://cdn.discordapp.com/icons/' + guildId + '/' + selected.icon + '.png' : '';
    const now = new Date().toISOString();
    db.set('servers', guildId, { serverId: guildId, serverName: guild.name, iconUrl, ownerId: guild.owner_id, updatedAt: now }, { merge: true });
    db.set('servers/' + guildId + '/config', 'roles', { list: roles.map((r: any) => r.name), detailed: roles.map((r: any) => ({ id: r.id, name: r.name })), updatedAt: now }, { merge: true });
    db.set('servers/' + guildId + '/config', 'channels', { list: channels.map((c: any) => ({ id: c.id, name: c.name, type: c.type })), updatedAt: now }, { merge: true });
    const roleNames = (member.roles || []).map((id: string) => roles.find((r: any) => r.id === id)?.name).filter(Boolean);
    db.set('servers/' + guildId + '/users', discordUserId, {
      discordUserId, username: member.user.username, displayName: member.nick || member.user.global_name || member.user.username,
      roles: member.roles || [], roleNames, isAdmin: guildAccess(selected).canInstall,
      isMod: true, twitchLogin: session.twitchUsername || '', updatedAt: now,
    }, { merge: true });
    db.set('discordServerConnections/' + session.spmtUserId + '/servers', guildId, {
      serverId: guildId, serverName: guild.name, iconUrl, discordUserId, connectedAt: now, botInstalled: true,
    }, { merge: true });
    db.set('discordServerConnections', session.spmtUserId!, { selectedServerId: guildId, updatedAt: now }, { merge: true });
    return NextResponse.json({ success: true, serverId: guildId, serverName: guild.name, iconUrl });
  } catch (error) { return failed(error); }
}
