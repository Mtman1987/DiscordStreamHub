import { NextRequest, NextResponse } from 'next/server';
import { PointsService } from '@/lib/points-service';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username, displayName, points } = await request.json();
    
    if (!userId || !username || points === undefined) {
      return NextResponse.json({ error: 'userId, username, and points are required' }, { status: 400 });
    }

    if (points <= 0) {
      return NextResponse.json({ error: 'Points must be positive' }, { status: 400 });
    }

    const pointsService = PointsService.getInstance();
    const updatedUser = await pointsService.addPoints(userId, username, displayName || username, points);
    
    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: `Added ${points} points to ${displayName || username}. New total: ${updatedUser?.points || 'unknown'}`
    });

  } catch (error) {
    console.error('Error adding points:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}