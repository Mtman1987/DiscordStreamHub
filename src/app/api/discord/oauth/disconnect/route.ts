import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = body.userId || body.discordUserId;

    if (!userId) {
      return NextResponse.json({ error: 'Discord user ID required' }, { status: 400 });
    }

    await db.collection('tokens').doc(`user_${userId}_discord`).delete();
    await db.collection('users').doc(`discord_${userId}`).delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Discord OAuth disconnect failed:', error);
    return NextResponse.json({ error: 'Failed to disconnect Discord OAuth' }, { status: 500 });
  }
}
