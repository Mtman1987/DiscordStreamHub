import { NextRequest, NextResponse } from 'next/server';
import { PointsService } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getDshPointsSecret } from '@/lib/runtime-secrets';
import { resolveSpmtPointsWallet } from '@/lib/spmt-wallet';

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

    const { userId, username, displayName, serverId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const pointsService = PointsService.getInstance();
    const userPoints = await pointsService.getUserPoints(userId, actualServerId);
    const resolvedName = userPoints?.displayName || displayName || username;

    const spmtWallet = await resolveSpmtPointsWallet({
      serverId: actualServerId,
      userId,
      metadata: { username, displayName: resolvedName },
    });
    if (spmtWallet) {
      return NextResponse.json({
        points: spmtWallet.points,
        currentPoints: spmtWallet.currentPoints,
        lifetimePoints: spmtWallet.lifetimePoints,
        rank: spmtWallet.rank,
        source: spmtWallet.source,
        username: userPoints?.username || username,
        displayName: resolvedName,
      });
    }

    const rank = await pointsService.getUserRank(userId, actualServerId);
    const legacyPoints = Number(userPoints?.points || 0);

    return NextResponse.json({
      points: legacyPoints,
      currentPoints: legacyPoints,
      lifetimePoints: legacyPoints,
      rank: rank?.rank ?? null,
      source: 'legacy',
      username: userPoints?.username || username,
      displayName: resolvedName,
    });
  } catch (error) {
    console.error('Error getting points balance:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
