import { NextRequest, NextResponse } from 'next/server';
import { startTwitchPolling } from '@/lib/twitch-polling-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    await startTwitchPolling(serverId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[StartPolling] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
