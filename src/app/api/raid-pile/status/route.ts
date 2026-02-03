import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const raidPileService = RaidPileService.getInstance();
    const piles = await raidPileService.getAllPiles();
    
    return NextResponse.json(piles);

  } catch (error) {
    console.error('Error fetching raid pile status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}