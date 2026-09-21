import { NextRequest, NextResponse } from 'next/server';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getDshPointsSecret } from '@/lib/runtime-secrets';
import { settleSpmtGamble } from '@/lib/spmt-client';
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

function toWholeAmount(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    if (!getDshPointsSecret()) return NextResponse.json({ error: 'Points service credential is not configured' }, { status: 503 });
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username, displayName, serverId, wager, payout, idempotencyKey, eventType, metadata } = await request.json();
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!idempotencyKey) return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });

    const wagerAmount = toWholeAmount(wager);
    const payoutAmount = toWholeAmount(payout);
    if (wagerAmount === null) return NextResponse.json({ error: 'wager must be a non-negative whole number' }, { status: 400 });
    if (payoutAmount === null) return NextResponse.json({ error: 'payout must be a non-negative whole number' }, { status: 400 });

    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const wallet = await resolveSpmtPointsWallet({
      serverId: actualServerId,
      userId,
      metadata: { username, displayName: displayName || username },
    });

    if (wallet) {
      const settlement = await settleSpmtGamble({
        userId: wallet.spmtUserId,
        wager: wagerAmount,
        payout: payoutAmount,
        idempotencyKey,
        eventType: eventType || 'gamble',
        metadata: { ...(metadata || {}), serverId: actualServerId, localUserId: userId },
      });

      if (settlement) {
        return NextResponse.json({
          settled: settlement.settled,
          duplicate: settlement.duplicate,
          points: settlement.spendableXp,
          currentPoints: settlement.spendableXp,
          lifetimePoints: settlement.lifetimeXp,
          rank: settlement.rank ?? null,
          refill: settlement.refill,
          matchedGrowth: settlement.matchedGrowth,
          source: 'spmt',
        });
      }
    }

    return NextResponse.json({ error: 'Canonical SPMT XP unavailable' }, { status: 503 });
  } catch (error) {
    console.error('Error settling gamble points:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
