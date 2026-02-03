import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, viewers, isLive } = await request.json();
    
    if (!userId || viewers === undefined) {
      return NextResponse.json({ error: 'userId and viewers are required' }, { status: 400 });
    }

    const raidPileService = RaidPileService.getInstance();
    await raidPileService.updateMemberViewers(userId, viewers, isLive !== false);
    
    return NextResponse.json({
      success: true,
      message: `Updated viewer count for user ${userId}: ${viewers} viewers`
    });

  } catch (error) {
    console.error('Error updating viewer count:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}