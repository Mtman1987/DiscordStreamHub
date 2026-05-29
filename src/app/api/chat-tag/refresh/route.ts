import { NextRequest, NextResponse } from 'next/server';
import { postOrUpdateGameEmbed } from '@/lib/chat-tag-service';

export const dynamic = 'force-dynamic';

const DEFAULT_SERVER_ID = process.env.HARDCODED_GUILD_ID || '1240832965865635881';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const serverId = body.serverId || body.guildId || DEFAULT_SERVER_ID;

    await postOrUpdateGameEmbed(serverId);

    return NextResponse.json({ success: true, serverId });
  } catch (error) {
    console.error('[ChatTagRefresh] Failed to refresh Chat Tag embed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}
