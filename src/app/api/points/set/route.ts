import { NextRequest, NextResponse } from 'next/server';
import { PointsService } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getDshPointsSecret } from '@/lib/runtime-secrets';

function isAuthorized(request: NextRequest): boolean {
  const pointsSecret = getDshPointsSecret();
  if (!pointsSecret) return false;
  const authHeader = request.headers.get('authorization');
  return Boolean(
    authHeader &&
    authHeader.startsWith('Bearer ') &&
    authHeader === `Bearer ${pointsSecret}`,
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!getDshPointsSecret()) return NextResponse.json({ error: 'Points service credential is not configured' }, { status: 503 });
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username, displayName, points, serverId } = await request.json();
    if (!userId || !username || points === undefined) {
      return NextResponse.json({ error: 'userId, username, and points are required' }, { status: 400 });
    }

    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const pointsService = PointsService.getInstance();
    const updatedUser = await pointsService.setPoints(
      userId,
      username,
      displayName || username,
      Number(points || 0),
      actualServerId,
    );

    return NextResponse.json({
      success: true,
      points: updatedUser.points,
    });
  } catch (error) {
    console.error('Error setting points:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
