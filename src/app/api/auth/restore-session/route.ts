import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export async function GET(request: Request) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const url = new URL(request.url);
    const requestedServerId =
      url.searchParams.get('serverId') ||
      url.searchParams.get('guildId') ||
      url.searchParams.get('discordServerId') ||
      getHardcodedGuildId();

    const storedSession = db.get('userSessions', requestedServerId);
    const serverConfig = storedSession || db.get('servers', requestedServerId);
    
    if (serverConfig) {
      return NextResponse.json({
        success: true,
        serverId: requestedServerId,
        userId: serverConfig.discordUserId || serverConfig.ownerId || '',
        twitchUsername: serverConfig.twitchUsername || '',
        discordUserId: serverConfig.discordUserId || '',
        discordUsername: serverConfig.discordUsername || '',
        discordDisplayName: serverConfig.discordDisplayName || serverConfig.discordUsername || '',
        discordAvatar: serverConfig.discordAvatar || '',
        serverName: serverConfig.serverName || '',
        iconUrl: serverConfig.iconUrl || '',
        isAdmin: Boolean(serverConfig.isAdmin),
      });
    }
    
    return NextResponse.json({ success: false });
  } catch (error) {
    console.error('Session restore failed:', error);
    return NextResponse.json({ success: false });
  }
}
