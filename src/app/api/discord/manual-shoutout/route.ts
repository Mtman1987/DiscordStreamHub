import { NextRequest, NextResponse } from 'next/server';
import { registerManualDiscordShoutout } from '@/lib/manual-discord-shoutout-service';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

function extractTwitchLogin(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const firstToken = raw.split(/\s+/)[0] || '';
  return firstToken
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9_]/gi, '')
    .toLowerCase()
    .slice(0, 25);
}

export async function POST(request: NextRequest) {
  try {
    if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const serverId = String(body.serverId || body.guildId || '').trim();
    const channelId = String(body.channelId || '').trim();
    const requesterName = String(body.requesterName || '').trim();
    const requesterDiscordId = String(body.requesterDiscordId || '').trim() || null;
    const rawTargetName = String(body.targetName || '').trim();
    const targetName = extractTwitchLogin(rawTargetName);
    const targetDiscordUserId = String(body.targetDiscordUserId || '').trim() || null;
    const sourceMessageId = String(body.sourceMessageId || '').trim() || null;

    if (!serverId || !channelId || !requesterName || (!targetName && !targetDiscordUserId)) {
      return NextResponse.json({
        error: 'serverId, channelId, requesterName, and targetName or targetDiscordUserId are required',
      }, { status: 400 });
    }

    if (rawTargetName && !targetName) {
      return NextResponse.json({ error: 'targetName must start with a valid Twitch username' }, { status: 400 });
    }

    const result = await registerManualDiscordShoutout({
      serverId,
      channelId,
      requesterName,
      requesterDiscordId,
      targetName,
      targetDiscordUserId,
      sourceMessageId,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[API /discord/manual-shoutout]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
