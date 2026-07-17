import { NextRequest, NextResponse } from 'next/server';
import { getChatTagApiBase, getHardcodedGuildId } from '@/lib/runtime-config';
import { getChatTagServiceSecret } from '@/lib/runtime-secrets';

export const dynamic = 'force-dynamic';

const DEFAULT_SERVER_ID = getHardcodedGuildId();
export async function POST(request: NextRequest) {
  try {
    const chatTagServiceSecret = getChatTagServiceSecret();
    if (!chatTagServiceSecret) {
      return NextResponse.json({ success: false, error: 'ChatTag service credential is not configured' }, { status: 503 });
    }
    const body = await request.json().catch(() => ({}));
    const serverId = body.serverId || body.guildId || DEFAULT_SERVER_ID;

    const response = await fetch(`${getChatTagApiBase()}/api/discord/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': chatTagServiceSecret },
      body: JSON.stringify({ refreshOnly: true, message: 'dsh compatibility refresh' }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.error || `Chat Tag returned ${response.status}`);
    }

    return NextResponse.json({ success: true, serverId, proxied: true, chatTag: result });
  } catch (error) {
    console.error('[ChatTagRefresh] Failed to proxy Chat Tag embed refresh:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}
