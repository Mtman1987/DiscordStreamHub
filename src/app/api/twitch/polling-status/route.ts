import { NextRequest, NextResponse } from 'next/server';
import { getTwitchPollingStatus } from '@/lib/twitch-polling-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    const isPolling = await getTwitchPollingStatus(serverId);
    return NextResponse.json({ isPolling });
  } catch (error) {
    console.error('[PollingStatus] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
