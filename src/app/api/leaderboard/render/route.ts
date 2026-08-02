import { NextRequest, NextResponse } from 'next/server';
import { generateLeaderboardImage } from '@/ai/flows/generate-leaderboard-image';
import { saveFile } from '@/lib/local-storage-service';
import { getAppUrl, getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { getServerBranding } from '@/lib/server-branding';

function isAuthorized(request: NextRequest): boolean {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const serverId = String(body?.serverId || getHardcodedGuildId() || '').trim();
    if (!serverId) {
      return NextResponse.json({ error: 'serverId is required' }, { status: 400 });
    }

    const branding = await getServerBranding(serverId);
    const image = await generateLeaderboardImage(serverId, branding);
    if (!image) {
      return NextResponse.json({ error: 'Failed to render leaderboard' }, { status: 503 });
    }

    const imageBuffer = Buffer.from(image.replace(/^data:image\/png;base64,/, ''), 'base64');
    const storedUrl = await saveFile(`leaderboard-images/${serverId}/leaderboard-${Date.now()}.png`, imageBuffer);
    const baseUrl = (getAppUrl() || request.nextUrl.origin).replace(/\/$/, '');
    const imageUrl = storedUrl.startsWith('http') ? storedUrl : `${baseUrl}${storedUrl}`;

    return NextResponse.json({
      title: `🏆 ${branding.serverName} Leaderboard`,
      imageUrl,
      scope: branding.serverName,
      updatedAt: new Date().toISOString(),
      rankButtonCustomId: `check_rank_${serverId}`,
    });
  } catch (error) {
    console.error('Failed to render leaderboard:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
