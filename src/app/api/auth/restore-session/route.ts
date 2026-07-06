import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

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
    
    if (serverConfig || userConfig) {
      return NextResponse.json({
        success: true,
        serverId: requestedServerId,
        userId: userConfig?.discordUserId || requestedUserId || '',
        twitchUsername: userConfig?.twitchLogin || userConfig?.twitchUsername || '',
        discordUserId: userConfig?.discordUserId || requestedUserId || '',
        discordUsername: userConfig?.username || userConfig?.discordUsername || '',
        discordDisplayName: userConfig?.displayName || userConfig?.discordDisplayName || userConfig?.username || '',
        discordAvatar: userConfig?.avatarUrl || userConfig?.discordAvatar || '',
        serverName: serverConfig.serverName || '',
        iconUrl: serverConfig.iconUrl || '',
        isAdmin: Boolean(userConfig?.isAdmin),
        userMatched: Boolean(userConfig),
      });
    }
    
    return NextResponse.json({ success: false });
  } catch (error) {
    console.error('Session restore failed:', error);
    return NextResponse.json({ success: false });
  }
}
