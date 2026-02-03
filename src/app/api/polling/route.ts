import { NextRequest, NextResponse } from 'next/server';
import { manualPoll } from '@/lib/polling-service';
import { schedulePolling, stopPolling } from '@/lib/cloud-scheduler';

export async function POST(request: NextRequest) {
  try {
    const { action, serverId } = await request.json();

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    switch (action) {
      case 'start':
        await schedulePolling(serverId);
        return NextResponse.json({ message: 'Polling scheduled successfully' });

      case 'stop':
        await stopPolling(serverId);
        return NextResponse.json({ message: 'Polling stopped successfully' });

      case 'manual':
        await manualPoll(serverId);
        return NextResponse.json({ message: 'Manual poll completed' });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Polling API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Cosmic Raid Polling Service',
    endpoints: {
      'POST /api/polling': {
        actions: ['start', 'stop', 'manual'],
        body: { action: 'string', serverId: 'string' }
      }
    }
  });
}