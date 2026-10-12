import { NextRequest, NextResponse } from 'next/server';
import { getDiscordClientId } from '@/lib/runtime-config';
import { botInstallUrl } from '@/lib/discord-server-permissions';
import { ServerConnectionError } from '@/lib/discord-server-connections';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {

    const response = NextResponse.redirect(botInstallUrl(getDiscordClientId()));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to invite SPMT.' },
      { status: error instanceof ServerConnectionError ? error.status : 503 });
  }
}
