import { NextRequest, NextResponse } from 'next/server';
import { cleanupOrphanedDiscordEmbeds } from '@/lib/discord-orphan-cleanup-service';
import { startTwitchPolling } from '@/lib/twitch-polling-service';
import { getHardcodedGuildId } from '@/lib/runtime-config';

const HARDCODED_SERVER_ID = getHardcodedGuildId();
let startupWorkQueued = false;

function startupServicesDisabled(): boolean {
  return process.env.DISABLE_STARTUP_SERVICES === 'true';
}

export async function POST(request: NextRequest) {
  try {
    if (startupServicesDisabled()) {
      console.log('[Startup] DISABLE_STARTUP_SERVICES=true; startup services skipped');
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Startup services disabled by environment',
        serverId: HARDCODED_SERVER_ID
      });
    }

    console.log('[Startup] Initializing automated services...');

    let queuedNow = false;
    if (!startupWorkQueued) {
      startupWorkQueued = true;
      queuedNow = true;
      queueStartupWork();
    } else {
      console.log('[Startup] Startup work already queued; skipping duplicate request');
    }

    return NextResponse.json({
      success: true, 
      message: queuedNow ? 'Automated services queued' : 'Automated services already queued',
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
  return NextResponse.json({
    message: 'Startup endpoint ready',
    startupServicesDisabled: startupServicesDisabled()
  });
}

function runStartupCleanup(): void {
  setTimeout(() => {
    cleanupOrphanedDiscordEmbeds(HARDCODED_SERVER_ID, { maxDeletesPerRun: 20 })
      .then((cleanupResult) => {
        if (cleanupResult.deleted > 0) {
          console.log(`[Startup] Discord cleanup removed ${cleanupResult.deleted} orphaned embeds`);
        }
      })
      .catch((cleanupError) => console.error('[Startup] Discord orphan cleanup failed:', cleanupError));
  }, 0);
}

function queueStartupWork(): void {
  setTimeout(() => {
    // Start the configured guild directly. The DB flag can be false after manual
    // stops or stale state, but this app should always resume shoutouts on boot.
    startTwitchPolling(HARDCODED_SERVER_ID)
      .then(() => console.log('[Startup] Twitch polling service initialized'))
      .catch((pollingError) => console.error('[Startup] Twitch polling startup failed:', pollingError));

    runStartupCleanup();
  }, 0);
}
