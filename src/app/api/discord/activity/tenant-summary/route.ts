import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/data/server-init';
import { getDiscordActivitySummary } from '@/lib/discord-activity-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

function isAuthorized(request: NextRequest): boolean {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
}

function getTenantName(serverId: string, data: Record<string, unknown>): string {
  return String(data.serverName || data.name || data.twitchChannel || serverId);
}

export async function POST(request: NextRequest) {
  try {
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

    const tenants = (await Promise.all(servers.map(async (server) => {
      const summary = await getDiscordActivitySummary(server.id, userId);
      if (!summary) return null;
      return {
        tenantId: server.id,
        serverId: server.id,
        tenantName: getTenantName(server.id, server.data),
        watchMinutes: Number(summary.voiceMinutes || 0),
        voiceMinutes: Number(summary.voiceMinutes || 0),
        messageCount: Number(summary.messageCount || 0),
        activeDays: Number(summary.activeDays || 0),
      };
    }))).filter((tenant): tenant is NonNullable<typeof tenant> => Boolean(tenant));

    tenants.sort((a, b) => Number(b.serverId === currentServerId) - Number(a.serverId === currentServerId));
    return NextResponse.json({ tenants });
  } catch (error) {
    console.error('Error fetching tenant Discord activity:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
