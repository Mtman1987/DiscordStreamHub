import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username, displayName } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const raidPileService = RaidPileService.getInstance();
    const success = await raidPileService.leavePile(userId);
    
    if (!success) {
      return NextResponse.json({ error: 'User not found in any pile' }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      message: `${displayName || username} left the raid pile. Safe travels, Captain!`
    });

  } catch (error) {
    console.error('Error leaving raid pile:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}