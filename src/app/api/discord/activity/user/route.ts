import { NextRequest, NextResponse } from 'next/server';
import { getDiscordActivitySummary } from '@/lib/discord-activity-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

function isAuthorized(request: NextRequest): boolean {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, serverId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const summary = await getDiscordActivitySummary(actualServerId, userId);

    return NextResponse.json({
      found: Boolean(summary),
      summary,
    });
  } catch (error) {
    console.error('Error getting Discord activity summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
