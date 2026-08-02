import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/data/server-init';
import { PointsService } from '@/lib/points-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getDshPointsSecret, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

function isAuthorized(request: NextRequest): boolean {
  const secret = getDshPointsSecret();
  return Boolean(secret && hasAuthorizedBearerToken(request.headers.get('authorization'), [secret]));
}

function getTenantName(serverId: string, data: Record<string, unknown>): string {
  return String(data.serverName || data.name || data.twitchChannel || serverId);
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
    const currentServerId = String(body?.serverId || getHardcodedGuildId() || '').trim();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const serverSnapshot = await db.collection('servers').get();
    const servers: Array<{ id: string; data: Record<string, unknown> }> = serverSnapshot.docs.map((doc: any) => ({
      id: String(doc.id),
      data: (doc.data() || {}) as Record<string, unknown>,
    }));
    if (currentServerId && !servers.some((server) => server.id === currentServerId)) {
      servers.push({ id: currentServerId, data: {} });
    }

    const pointsService = PointsService.getInstance();
    const tenants = (await Promise.all(servers.map(async (server) => {
      const [points, rank] = await Promise.all([
        pointsService.getUserPoints(userId, server.id),
        pointsService.getUserRank(userId, server.id),
      ]);
      if (!points && !rank) return null;
      const value = Number(points?.points ?? rank?.points ?? 0);
      return {
        tenantId: server.id,
        serverId: server.id,
        tenantName: getTenantName(server.id, server.data),
        currentPoints: value,
        lifetimePoints: value,
        rank: rank?.rank ?? null,
      };
    }))).filter((tenant): tenant is NonNullable<typeof tenant> => Boolean(tenant));

    tenants.sort((a, b) => Number(b.serverId === currentServerId) - Number(a.serverId === currentServerId));
    return NextResponse.json({ tenants });
  } catch (error) {
    console.error('Error fetching tenant point balances:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
