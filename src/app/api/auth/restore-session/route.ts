import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

function hasTenantAdminAccess(serverConfig: any, userConfig: any, userId: string) {
  if (!userConfig || !userId) return false;
  if (userConfig.isAdmin === true || String(serverConfig?.ownerId || '') === userId) return true;

  const configuredRoles = Array.isArray(serverConfig?.adminRoles)
    ? serverConfig.adminRoles.map((role: unknown) => String(role).trim().toLowerCase()).filter(Boolean)
    : [];
  const userRoles = [
    ...(Array.isArray(userConfig.roles) ? userConfig.roles : []),
    ...(Array.isArray(userConfig.roleNames) ? userConfig.roleNames : []),
  ].map((role: unknown) => String(role).trim().toLowerCase()).filter(Boolean);

  return userRoles.some((role: string) => configuredRoles.includes(role));
}

export async function GET(request: Request) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const url = new URL(request.url);
    const requestedUserId =
      url.searchParams.get('userId') ||
      url.searchParams.get('discordUserId') ||
      url.searchParams.get('discord_user_id') ||
      '';
    const requestedServerId =
      url.searchParams.get('serverId') ||
      url.searchParams.get('guildId') ||
      url.searchParams.get('discordServerId') ||
      getHardcodedGuildId();

    const serverConfig = db.get('servers', requestedServerId);
    const userProfile = requestedUserId
      ? db.get(`servers/${requestedServerId}/users`, requestedUserId)
      : null;
    const storedSession = requestedUserId
      ? db.get('userSessions', requestedServerId)
      : null;
    const sessionMatchesUser = Boolean(
      requestedUserId &&
      storedSession?.discordUserId &&
      String(storedSession.discordUserId) === String(requestedUserId)
    );
    const userConfig = userProfile || (sessionMatchesUser ? storedSession : null);
    const resolvedUserId = String(userConfig?.discordUserId || requestedUserId || '');
    
    if (serverConfig || userConfig) {
      return NextResponse.json({
        success: true,
        serverId: requestedServerId,
        userId: resolvedUserId,
        twitchUsername: userConfig?.twitchLogin || userConfig?.twitchUsername || '',
        discordUserId: resolvedUserId,
        discordUsername: userConfig?.username || userConfig?.discordUsername || '',
        discordDisplayName: userConfig?.displayName || userConfig?.discordDisplayName || userConfig?.username || '',
        discordAvatar: userConfig?.avatarUrl || userConfig?.discordAvatar || '',
        serverName: serverConfig.serverName || '',
        iconUrl: serverConfig.iconUrl || '',
        isAdmin: hasTenantAdminAccess(serverConfig, userConfig, resolvedUserId),
        userMatched: Boolean(userConfig),
      });
    }
    
    return NextResponse.json({ success: false });
  } catch (error) {
    console.error('Session restore failed:', error);
    return NextResponse.json({ success: false });
  }
}
