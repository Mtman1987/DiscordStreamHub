import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export async function GET(request: NextRequest) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for db init
    const serverId = request.nextUrl.searchParams.get('serverId') || getHardcodedGuildId() || '1240832965865635881';
    const serverBot = db.get('users', `twitch_${serverId}`);

    if (serverBot) {
      return NextResponse.json({
        connected: true,
        user: { username: serverBot.username || serverBot.displayName || 'Twitch Bot' }
      });
    }

    const twitchUsers = db.query('users', [{ field: 'source', op: '==', value: 'twitch' }]);
    const botData = twitchUsers[0]?.data || null;
    
    if (botData) {
      return NextResponse.json({ 
        connected: true, 
        user: { username: botData.username || botData.displayName } 
      });
    }
    
    return NextResponse.json({ connected: false });
  } catch (error) {
    console.error('OAuth status check failed:', error);
    return NextResponse.json({ connected: false });
  }
}
