import { NextRequest, NextResponse } from 'next/server';
import { getRelayPresence, getRelayPresenceByName, recordRelayVoicePresence } from '@/lib/relay-presence';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export const dynamic = 'force-dynamic';

function botAuthorized(request: NextRequest): boolean {
  const configured = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const supplied = String(request.headers.get('x-discord-bot-token') || '').trim();
  return Boolean(configured && supplied && configured === supplied);
}

function serviceAuthorized(request: NextRequest): boolean {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
}

export async function POST(request: NextRequest) {
  if (!botAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null) as any;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  const row = recordRelayVoicePresence({
    userId: body.userId,
    guildId: body.guildId,
    username: body.username,
    displayName: body.displayName,
    channelId: body.channelId,
    channelName: body.channelName,
    observedAt: body.observedAt,
  });
  if (!row) return NextResponse.json({ error: 'userId and guildId are required' }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  if (!serviceAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = String(request.nextUrl.searchParams.get('userId') || '').trim();
  const username = String(request.nextUrl.searchParams.get('username') || '').trim();
  const guildId = String(request.nextUrl.searchParams.get('guildId') || '').trim();
  if (!userId && !username) return NextResponse.json({ error: 'userId or username is required' }, { status: 400 });
  const presence = userId
    ? getRelayPresence(userId, guildId || undefined)
    : getRelayPresenceByName(username, guildId || undefined);
  return NextResponse.json(presence || { found: false, inVoice: false, recentlyChatting: false, preferredKind: null, preferredChannelId: null });
}
