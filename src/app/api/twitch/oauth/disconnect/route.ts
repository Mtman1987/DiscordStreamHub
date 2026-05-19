import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const body = await request.json().catch(() => ({}));
    const serverId = body.serverId || process.env.HARDCODED_GUILD_ID || '1240832965865635881';

    db.delete('users', `twitch_${serverId}`);

    const twitchUsers = db.query('users', [{ field: 'source', op: '==', value: 'twitch' }]);
    
    for (const user of twitchUsers) {
      db.delete('users', user.id);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Disconnect failed:', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
