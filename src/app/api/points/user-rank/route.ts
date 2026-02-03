import { NextRequest, NextResponse } from 'next/server';
import { PointsService } from '@/lib/points-service';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const pointsService = PointsService.getInstance();
    const userRank = await pointsService.getUserRank(userId);
    const userPoints = await pointsService.getUserPoints(userId);
    
    if (!userRank) {
      return NextResponse.json({ 
        rank: null,
        points: 0,
        message: `${username || 'User'} is not on the leaderboard yet!`
      });
    }

    return NextResponse.json({
      rank: userRank.rank,
      points: userRank.points,
      username: userPoints?.username || username,
      displayName: userPoints?.displayName || username,
      message: `${userPoints?.displayName || username} is rank #${userRank.rank} with ${userRank.points.toLocaleString()} points!`
    });

  } catch (error) {
    console.error('Error getting user rank:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}