import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serverAccount, ServerConnectionError } from '@/lib/discord-server-connections';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const session = await serverAccount(request);
    const serverId = session.discordServerId;
    const userId = session.discordUserId || db.get('discordServerOAuth', session.spmtUserId!)?.discordUserId || '';
    if (!serverId || !userId) return NextResponse.json({ success: false });
    const server = db.get('servers', serverId);
    const profile = db.get('servers/' + serverId + '/users', userId);
    if (!server || !profile) return NextResponse.json({ success: false });
    return NextResponse.json({
      success: true, serverId, userId, discordUserId: userId, userMatched: true,
      twitchUsername: session.twitchUsername || '',
      discordUsername: profile.username || session.discordUsername || '',
      discordDisplayName: profile.displayName || session.discordDisplayName || '',
      discordAvatar: profile.avatarUrl || session.discordAvatar || '',
      serverName: server.serverName || '', iconUrl: server.iconUrl || '',
      isAdmin: profile.isAdmin === true || server.ownerId === userId,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: error instanceof ServerConnectionError ? error.status : 503 });
  }
}
