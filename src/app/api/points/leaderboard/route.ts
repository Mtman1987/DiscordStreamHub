import { NextRequest, NextResponse } from 'next/server';
import { PointsService } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const serverId = searchParams.get('serverId') || getHardcodedGuildId() || 'default';
    
    const pointsService = PointsService.getInstance();
    const leaderboard = await pointsService.getLeaderboard(limit, serverId);
    
    return NextResponse.json(leaderboard);

  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
