import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export async function POST(request: NextRequest) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const body = await request.json().catch(() => ({}));
    const serverId = body.serverId || getHardcodedGuildId();

    await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').delete().catch(() => {});
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
