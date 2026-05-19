import { NextRequest, NextResponse } from 'next/server';
import { cleanupOrphanedDiscordEmbeds } from '@/lib/discord-orphan-cleanup-service';
import { startTwitchPolling } from '@/lib/twitch-polling-service';

const HARDCODED_SERVER_ID = process.env.HARDCODED_GUILD_ID || '1240832965865635881';

export async function POST(request: NextRequest) {
  try {
    console.log('[Startup] Initializing automated services...');
    
    // Start the configured guild directly. The DB flag can be false after manual
    // stops or stale state, but this app should always resume shoutouts on boot.
    await startTwitchPolling(HARDCODED_SERVER_ID);
    console.log('[Startup] Twitch polling service initialized');

    runStartupCleanup();
    
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

function runStartupCleanup(): void {
  setTimeout(() => {
    cleanupOrphanedDiscordEmbeds(HARDCODED_SERVER_ID, { maxDeletesPerRun: 20 })
      .then((cleanupResult) => console.log('[Startup] Discord orphan cleanup completed:', cleanupResult))
      .catch((cleanupError) => console.error('[Startup] Discord orphan cleanup failed:', cleanupError));
  }, 0);
}
