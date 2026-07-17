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

    const { points, serverId } = await request.json();
    if (points === undefined) {
      return NextResponse.json({ error: 'points is required' }, { status: 400 });
    }

    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const pointsService = PointsService.getInstance();
    const result = await pointsService.setPointsToAll(Number(points || 0), actualServerId);

    return NextResponse.json({
      success: true,
      count: result.count,
    });
  } catch (error) {
    console.error('Error setting points for all users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
