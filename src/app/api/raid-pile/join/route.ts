import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username, displayName } = await request.json();
    
    if (!userId || !username) {
      return NextResponse.json({ error: 'userId and username are required' }, { status: 400 });
    }

    const raidPileService = RaidPileService.getInstance();
    const result = await raidPileService.joinPile(userId, username, displayName || username);
    
    return NextResponse.json({
      success: true,
      pileId: result.pileId,
      message: `🏔️ ${displayName || username} joined the Space Mountain Raid Pile!`
    });

  } catch (error) {
    console.error('Error joining raid pile:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}