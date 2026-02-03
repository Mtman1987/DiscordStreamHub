import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();

    if (!serverId) {
      return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });
    }

    // Get all users
    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
    
    let cleared = 0;
    for (const userDoc of usersSnapshot.docs) {
      const shoutoutStateDoc = await db.collection('servers').doc(serverId)
        .collection('users').doc(userDoc.id)
        .collection('shoutoutState').doc('current').get();
      
      if (shoutoutStateDoc.exists) {
        await shoutoutStateDoc.ref.delete();
        cleared++;
      }
    }

    console.log(`[API /twitch/clear-shoutouts] Cleared ${cleared} shoutout states`);

    return NextResponse.json({ success: true, cleared });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /twitch/clear-shoutouts]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
