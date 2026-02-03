import { NextRequest, NextResponse } from 'next/server';
import { enablePolling } from '@/lib/setup-service';
import { startTwitchPolling } from '@/lib/twitch-polling-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();

    await enablePolling(serverId);
    await startTwitchPolling(serverId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
