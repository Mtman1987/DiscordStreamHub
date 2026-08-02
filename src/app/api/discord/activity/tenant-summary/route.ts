import { NextRequest, NextResponse } from 'next/server';
import { getDiscordActivitySummary } from '@/lib/discord-activity-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { listTenantDescriptors } from '@/lib/tenant-registry';

function isAuthorized(request: NextRequest): boolean {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
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

    const servers = await listTenantDescriptors(currentServerId);

    const tenants = (await Promise.all(servers.map(async (server) => {
      const summary = await getDiscordActivitySummary(server.id, userId);
      if (!summary) return null;
      return {
        tenantId: server.id,
        serverId: server.id,
        tenantName: server.branding.serverName,
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
