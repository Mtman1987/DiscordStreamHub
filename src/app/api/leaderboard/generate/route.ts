'use server';

import { NextRequest, NextResponse } from 'next/server';
import { generateAndPostLeaderboard } from '@/lib/leaderboard-discord-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    
    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }
    
    // Don't await, let it run in the background
    generateAndPostLeaderboard(serverId).catch(console.error);
    
    return NextResponse.json({ success: true, message: 'Leaderboard generation and posting initiated.' });
  } catch (error) {
    console.error('Error generating leaderboard:', error);
    return NextResponse.json({ error: 'Failed to initiate leaderboard generation' }, { status: 500 });
  }
}
