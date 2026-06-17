import { NextRequest, NextResponse } from 'next/server';
import { registerManualDiscordShoutout } from '@/lib/manual-discord-shoutout-service';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const serverId = String(body.serverId || body.guildId || '').trim();
    const channelId = String(body.channelId || '').trim();
    const requesterName = String(body.requesterName || '').trim();
    const requesterDiscordId = String(body.requesterDiscordId || '').trim() || null;
    const targetName = String(body.targetName || '').trim();
    const targetDiscordUserId = String(body.targetDiscordUserId || '').trim() || null;
    const sourceMessageId = String(body.sourceMessageId || '').trim() || null;

    if (!serverId || !channelId || !requesterName || (!targetName && !targetDiscordUserId)) {
      return NextResponse.json({
        error: 'serverId, channelId, requesterName, and targetName or targetDiscordUserId are required',
      }, { status: 400 });
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
