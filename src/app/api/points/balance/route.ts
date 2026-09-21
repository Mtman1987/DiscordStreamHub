import { NextRequest, NextResponse } from 'next/server';
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
    const resolvedName = displayName || username;

    const spmtWallet = await resolveSpmtPointsWallet({
      serverId: actualServerId,
      userId,
      metadata: { username, displayName: resolvedName },
    });
    if (!spmtWallet) {
      return NextResponse.json({ error: 'Canonical SPMT XP wallet unavailable' }, { status: 503 });
    }

    return NextResponse.json({
      points: spmtWallet.points,
      currentPoints: spmtWallet.currentPoints,
      lifetimePoints: spmtWallet.lifetimePoints,
      rank: spmtWallet.rank,
      source: 'spmt',
      username,
      displayName: resolvedName,
    });
  } catch (error) {
    console.error('Error getting points balance:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
