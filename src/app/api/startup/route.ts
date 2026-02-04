import { NextRequest, NextResponse } from 'next/server';
import { initializeTwitchPolling } from '@/lib/twitch-polling-service';

const HARDCODED_SERVER_ID = process.env.HARDCODED_GUILD_ID || '1240832965865635881';

export async function POST(request: NextRequest) {
  try {
    console.log('[Startup] Initializing automated services...');
    
    // Initialize twitch polling service (checks DB for active servers)
    await initializeTwitchPolling();
    console.log('[Startup] Twitch polling service initialized');
    
    return NextResponse.json({ 
      success: true, 
      message: 'All automated services started successfully',
      serverId: HARDCODED_SERVER_ID
    });
    
  } catch (error) {
    console.error('[Startup] Error starting services:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Startup endpoint ready' });
}