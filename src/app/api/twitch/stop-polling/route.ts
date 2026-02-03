import { NextRequest, NextResponse } from 'next/server';
import { stopTwitchPolling } from '@/lib/twitch-polling-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    await stopTwitchPolling(serverId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[StopPolling] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
