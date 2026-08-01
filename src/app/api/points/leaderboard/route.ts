import { NextRequest, NextResponse } from 'next/server';
import { PointsService } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getDshPointsSecret, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { getSpmtXpLeaderboard } from '@/lib/spmt-client';

export async function GET(request: NextRequest) {
  try {
    const pointsSecret = getDshPointsSecret();
    if (!pointsSecret) return NextResponse.json({ error: 'Points service credential is not configured' }, { status: 503 });
    if (!hasAuthorizedBearerToken(request.headers.get('authorization'), [pointsSecret])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const serverId = searchParams.get('serverId') || getHardcodedGuildId() || 'default';
    
    // Ranks come from lifetime XP so spending never drops anyone down the board.
    const canonical = await getSpmtXpLeaderboard(limit);
    if (canonical.length) {
      return NextResponse.json(canonical.map((entry) => ({
        id: entry.userId,
        userProfileId: entry.userId,
        rank: entry.rank,
        points: entry.lifetimeXp,
        currentPoints: entry.spendableXp,
        lifetimePoints: entry.lifetimeXp,
        source: 'spmt',
        lastEventMetadata: {
          username: entry.username,
          displayName: entry.displayName || entry.username,
          avatarUrl: entry.avatarUrl,
        },
      })));
    }

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
