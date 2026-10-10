
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDiscordClientId } from '@/lib/runtime-config';
import { serverAccount, ServerConnectionError } from '@/lib/discord-server-connections';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    await serverAccount(request);
    if (!process.env.DISCORD_CLIENT_SECRET) throw new ServerConnectionError('Discord connection is not configured.', 503);
    const state = 'dsh-servers:' + randomBytes(32).toString('hex');
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: getDiscordClientId(), response_type: 'code',
      redirect_uri: request.nextUrl.origin + '/api/discord/oauth/callback',
      scope: 'identify guilds', state }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set('dsh_discord_server_state', state, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to connect Discord.' },
      { status: error instanceof ServerConnectionError ? error.status : 503 });
  }
}
