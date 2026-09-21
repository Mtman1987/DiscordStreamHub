import { NextRequest, NextResponse } from 'next/server';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getDshPointsSecret, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { repairLegacyLeaderboardIdentityAliases } from '@/lib/leaderboard-identity-repair';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const pointsSecret = getDshPointsSecret();
  if (!pointsSecret) {
    return NextResponse.json({ error: 'Points service credential is not configured' }, { status: 503 });
  }
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), [pointsSecret])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const serverId = String(body?.serverId || getHardcodedGuildId() || '').trim();
    if (!serverId) return NextResponse.json({ error: 'serverId is required' }, { status: 400 });

    const result = await repairLegacyLeaderboardIdentityAliases(serverId, {
      force: body?.force === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[leaderboard identity repair] failed:', error);
    return NextResponse.json({ error: 'Leaderboard identity repair failed' }, { status: 500 });
  }
}
