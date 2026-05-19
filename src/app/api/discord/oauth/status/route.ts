import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const userId = request.nextUrl.searchParams.get('userId') || request.nextUrl.searchParams.get('discordUserId');

    if (userId) {
      const tokenDoc = await db.collection('tokens').doc(`user_${userId}_discord`).get();
      if (tokenDoc.exists) {
        const t = tokenDoc.data();
        return NextResponse.json({
          connected: true,
          user: { id: t.user_id || userId, username: t.username, avatar: t.avatar }
        });
      }

      const userDoc = await db.collection('users').doc(`discord_${userId}`).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        return NextResponse.json({
          connected: true,
          user: { id: u.discordId || u.id || userId, username: u.username, avatar: u.avatar }
        });
      }

      return NextResponse.json({ connected: false });
    }

    // Check tokens collection (where the OAuth callback saves)
    const allTokens = db.query('tokens', [{ field: 'source', op: '==', value: 'hearmeout' }]);
    if (allTokens.length > 0) {
      const t = allTokens[0].data;
      return NextResponse.json({
        connected: true,
        user: { id: t.user_id, username: t.username, avatar: t.avatar }
      });
    }

    // Fallback: check users collection for discord users from OAuth exchange
    const discordUsers = db.query('users', [{ field: 'source', op: '==', value: 'dsh' }])
      .filter((u: any) => u.id.startsWith('discord_'));
    if (discordUsers.length > 0) {
      const u = discordUsers[0].data;
      return NextResponse.json({
        connected: true,
        user: { id: u.discordId || u.id, username: u.username }
      });
    }

    return NextResponse.json({ connected: false });
  } catch (error) {
    console.error('OAuth status check error:', error);
    return NextResponse.json({ connected: false });
  }
}
