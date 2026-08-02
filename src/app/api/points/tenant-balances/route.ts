import { NextRequest, NextResponse } from 'next/server';
import { getDiscordActivitySummary } from '@/lib/discord-activity-service';
import { PointsService } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getDshPointsSecret, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { resolveSpmtPointsWallet } from '@/lib/spmt-wallet';
import { listTenantDescriptors } from '@/lib/tenant-registry';
import { resolveTenantBalance } from '@/lib/tenant-utils';

function isAuthorized(request: NextRequest): boolean {
  const secret = getDshPointsSecret();
  return Boolean(secret && hasAuthorizedBearerToken(request.headers.get('authorization'), [secret]));
}

export async function POST(request: NextRequest) {
  try {
    if (!getDshPointsSecret()) {
      return NextResponse.json({ error: 'Points service credential is not configured' }, { status: 503 });
    }
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = String(body?.userId || '').trim();
    const username = String(body?.username || '').trim();
    const displayName = String(body?.displayName || username).trim();
    const currentServerId = String(body?.serverId || getHardcodedGuildId() || '').trim();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const [servers, canonicalWallet] = await Promise.all([
      listTenantDescriptors(currentServerId),
      resolveSpmtPointsWallet({
        serverId: currentServerId || 'default',
        userId,
        metadata: { username, displayName },
      }),
    ]);

    const pointsService = PointsService.getInstance();
    const tenants = (await Promise.all(servers.map(async (server) => {
      const [points, rank, activity] = await Promise.all([
        pointsService.getUserPoints(userId, server.id),
        pointsService.getUserRank(userId, server.id),
        getDiscordActivitySummary(server.id, userId),
      ]);
      const isCurrentTenant = Boolean(currentServerId && server.id === currentServerId);
      if (!points && !rank && !activity && !isCurrentTenant) return null;
      const balance = resolveTenantBalance(
        canonicalWallet,
        Number(points?.points ?? rank?.points ?? 0),
        rank?.rank ?? null,
      );
      return {
        tenantId: server.id,
        serverId: server.id,
        tenantName: server.branding.serverName,
        ...balance,
      };
    }))).filter((tenant): tenant is NonNullable<typeof tenant> => Boolean(tenant));

    tenants.sort((a, b) => Number(b.serverId === currentServerId) - Number(a.serverId === currentServerId));
    return NextResponse.json({ tenants });
  } catch (error) {
    console.error('Error fetching tenant point balances:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
