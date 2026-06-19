import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export async function GET(request: NextRequest) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for db init
    const serverId = request.nextUrl.searchParams.get('serverId') || getHardcodedGuildId();
    const botDoc = await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').get();
    if (botDoc.exists) {
      const data = botDoc.data() || {};
      const refreshErrorCode = String(data.refreshErrorCode || '').trim();
      const connected = Boolean(data.accessToken || data.refreshToken) && refreshErrorCode !== 'invalid_refresh_token';
      return NextResponse.json({
        connected,
        needsReconnect: refreshErrorCode === 'invalid_refresh_token',
        user: data.botUsername ? { username: data.botUsername } : null,
        lastError: typeof data.lastRefreshError === 'string' ? data.lastRefreshError : null,
      });
    }

    const serverBot = db.get('users', `twitch_${serverId}`);

    if (serverBot) {
      return NextResponse.json({
        connected: true,
        needsReconnect: false,
        user: { username: serverBot.username || serverBot.displayName || 'Twitch Bot' },
        lastError: null,
      });
    }

    const twitchUsers = db.query('users', [{ field: 'source', op: '==', value: 'twitch' }]);
    const botData = twitchUsers[0]?.data || null;
    
    if (botData) {
      return NextResponse.json({ 
        connected: true, 
        needsReconnect: false,
        user: { username: botData.username || botData.displayName },
        lastError: null,
      });
    }
    
    return NextResponse.json({ connected: false, needsReconnect: false, user: null, lastError: null });
  } catch (error) {
    console.error('OAuth status check failed:', error);
    return NextResponse.json({ connected: false, needsReconnect: false, user: null, lastError: 'status-check-failed' });
  }
}
