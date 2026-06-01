import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';

export async function GET(request: NextRequest) {
  try {
    const raidPileService = RaidPileService.getInstance();
    const piles = await raidPileService.getAllPiles();
    
    return NextResponse.json(piles);

  } catch (error) {
    console.error('Error fetching raid pile status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
