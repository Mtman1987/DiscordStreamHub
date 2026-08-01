import { NextRequest, NextResponse } from 'next/server';
import { generateLeaderboardImage } from '@/ai/flows/generate-leaderboard-image';
import { saveFile } from '@/lib/local-storage-service';
import { getAppUrl, getHardcodedGuildId } from '@/lib/runtime-config';
import { getServerBranding } from '@/lib/server-branding';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const serverId = String(body?.serverId || getHardcodedGuildId() || '').trim();
  if (!serverId) {
    return NextResponse.json({ error: 'serverId is required' }, { status: 400 });
  }

  const image = await generateLeaderboardImage(serverId);
  if (!image) {
    return NextResponse.json({ error: 'Leaderboard image generation failed' }, { status: 503 });
  }

  const buffer = Buffer.from(image.replace(/^data:image\/png;base64,/, ''), 'base64');
  const storedUrl = await saveFile(`leaderboard-images/${serverId}/leaderboard-${Date.now()}.png`, buffer);
  const baseUrl = (getAppUrl() || request.nextUrl.origin).replace(/\/$/, '');
  const imageUrl = storedUrl.startsWith('http') ? storedUrl : `${baseUrl}${storedUrl}`;
  const branding = await getServerBranding(serverId);

  return NextResponse.json({
    title: `${branding.serverName} Leaderboard`,
    imageUrl,
    leaderboardImageUrl: imageUrl,
    scope: serverId,
    updatedAt: new Date().toISOString(),
    rankButtonCustomId: `sw_dsh_rank:${serverId}`,
  });
}
