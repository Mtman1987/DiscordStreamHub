import { NextRequest, NextResponse } from 'next/server';
import { hasValidOAuthToken } from '@/lib/twitch-oauth-service';

export async function GET(request: NextRequest) {
  const serverId = request.nextUrl.searchParams.get('serverId');

  if (!serverId) {
    return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });
  }

  const connected = await hasValidOAuthToken(serverId);

  return NextResponse.json({ connected });
}
