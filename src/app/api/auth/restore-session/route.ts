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
      getHardcodedGuildId() ||
      '1240832965865635881';

    const serverConfig = db.get('servers', requestedServerId) || db.get('userSessions', requestedServerId);
    
    if (serverConfig) {
      return NextResponse.json({
        success: true,
        serverId: requestedServerId,
        userId: serverConfig.ownerId || '',
        twitchUsername: serverConfig.twitchUsername || '',
        discordUserId: serverConfig.discordUserId || '',
        discordUsername: serverConfig.discordUsername || '',
        discordAvatar: serverConfig.discordAvatar || '',
        serverName: serverConfig.serverName || '',
        iconUrl: serverConfig.iconUrl || '',
      });
    }
    
    return NextResponse.json({ success: false });
  } catch (error) {
    console.error('Session restore failed:', error);
    return NextResponse.json({ success: false });
  }
}
