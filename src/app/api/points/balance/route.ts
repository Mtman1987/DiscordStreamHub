import { NextRequest, NextResponse } from 'next/server';
import { PointsService } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return Boolean(
    authHeader &&
    authHeader.startsWith('Bearer ') &&
    authHeader.split(' ')[1] === process.env.BOT_SECRET_KEY,
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username, displayName, serverId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const pointsService = PointsService.getInstance();
    const rank = await pointsService.getUserRank(userId, actualServerId);
    const userPoints = await pointsService.getUserPoints(userId, actualServerId);

    return NextResponse.json({
      points: Number(userPoints?.points || 0),
      rank: rank?.rank ?? null,
      username: userPoints?.username || username,
      displayName: userPoints?.displayName || displayName || username,
    });
  } catch (error) {
    console.error('Error getting points balance:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
