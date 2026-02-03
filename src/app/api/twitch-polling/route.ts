import { NextRequest, NextResponse } from 'next/server';
import { schedulePolling, stopPolling, getPollingStatus } from '@/lib/cloud-scheduler';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('serverId');

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    const isPolling = await getPollingStatus(serverId);
    return NextResponse.json({ isPolling });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /twitch-polling GET]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, serverId } = await request.json();

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    switch (action) {
      case 'start':
        await schedulePolling(serverId);
        return NextResponse.json({ success: true, message: 'Twitch polling started' });

      case 'stop':
        await stopPolling(serverId);
        return NextResponse.json({ success: true, message: 'Twitch polling stopped' });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /twitch-polling POST]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
