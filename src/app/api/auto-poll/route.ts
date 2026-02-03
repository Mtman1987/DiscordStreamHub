import { NextRequest, NextResponse } from 'next/server';
import { startPolling } from '@/lib/polling-service';

export async function POST(request: NextRequest) {
  try {
    const serverId = process.env.HARDCODED_GUILD_ID;
    
    if (!serverId) {
      return NextResponse.json({ error: 'Server ID not configured' }, { status: 400 });
    }

    console.log('Auto-starting polling service...');
    await startPolling(serverId);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Polling service started automatically',
      serverId 
    });
  } catch (error) {
    console.error('Error auto-starting polling:', error);
    return NextResponse.json({ 
      error: 'Failed to start polling service',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Auto-start on server startup
export async function GET() {
  return POST(new NextRequest('http://localhost/api/auto-poll', { method: 'POST' }));
}