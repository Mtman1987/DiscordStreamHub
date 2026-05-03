import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const serverId =
    request.nextUrl.searchParams.get('serverId') ||
    request.nextUrl.searchParams.get('guildId') ||
    request.nextUrl.searchParams.get('discordServerId');
  
  if (!serverId) {
    return NextResponse.json({ error: 'serverId required' }, { status: 400 });
  }

  const channelsData = await db.getAsync(`servers/${serverId}/config`, 'channels');
  
  if (!channelsData) {
    return NextResponse.json([]);
  }

  const channelsList = channelsData.list || [];
  return NextResponse.json(channelsList.filter((c: any) => [0, 2, 5, 11, 13].includes(c.type)));
}
