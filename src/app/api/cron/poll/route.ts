'use server';

import { NextRequest, NextResponse } from 'next/server';
import { runAutomatedShoutoutCycle } from '@/lib/automated-shoutout-system';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!expectedAuth || authHeader !== expectedAuth) {
      console.warn('[API/Cron] Unauthorized attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const serverId = body.serverId || process.env.HARDCODED_GUILD_ID;

    if (!serverId) {
      return NextResponse.json({ error: 'No server ID available' }, { status: 400 });
    }

    // Run the cycle asynchronously without waiting for it to finish
    runAutomatedShoutoutCycle(serverId, { force: true }).catch(error => {
      console.error(`[API/Cron] Unhandled error in background shoutout cycle for server ${serverId}:`, error);
    });

    return NextResponse.json({
      success: true,
      message: 'Automated shoutout cycle triggered successfully.',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[API/Cron] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    return new Response('Not found', { status: 404 });
  }
  // Allow manual trigger in development via browser
  const serverId = request.nextUrl.searchParams.get('serverId') || process.env.HARDCODED_GUILD_ID;
  if (!serverId) {
    return NextResponse.json({ error: 'Provide a ?serverId=... query parameter.' }, { status: 400 });
  }

  runAutomatedShoutoutCycle(serverId, { force: true }).catch(console.error);

  return NextResponse.json({
    message: 'Manual development trigger for shoutout cycle initiated.',
    serverId,
  });
}
