import { NextRequest, NextResponse } from 'next/server';
import { sqliteService } from '@/lib/sqlite-service';

export async function GET(request: NextRequest) {
  try {
    const serverId =
      request.nextUrl.searchParams.get('serverId') ||
      request.nextUrl.searchParams.get('guildId') ||
      request.nextUrl.searchParams.get('discordServerId');
    
    if (!serverId) {
      return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });
    }
    
    const serverDoc = await sqliteService.getDocument('servers', serverId);
    
    if (serverDoc) {
      return NextResponse.json({
        serverName: serverDoc.serverName || serverDoc.name,
        name: serverDoc.serverName || serverDoc.name,
        iconUrl: serverDoc.iconUrl || serverDoc.icon
      });
    }
    
    return NextResponse.json({ serverName: null, name: null });
  } catch (error) {
    console.error('Server info fetch failed:', error);
    return NextResponse.json({ serverName: null, name: null });
  }
}
