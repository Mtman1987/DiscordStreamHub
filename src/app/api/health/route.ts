import { NextResponse } from 'next/server';
import { getTwitchPollingStatus } from '@/lib/twitch-polling-service';

const HARDCODED_SERVER_ID = process.env.HARDCODED_GUILD_ID || '1240832965865635881';

export async function GET() {
  try {
    const isPolling = await getTwitchPollingStatus(HARDCODED_SERVER_ID);
    
    return NextResponse.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      polling: {
        active: isPolling,
        serverId: HARDCODED_SERVER_ID
      }
    });
  } catch (error) {
    return NextResponse.json({ 
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
