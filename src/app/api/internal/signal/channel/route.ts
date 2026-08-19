import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

const SERVER_ID = getHardcodedGuildId();
const SIGNAL_CHANNEL_NAME = 'comms-lounge';
const SIGNAL_CHANNEL_ID = '1283213768419180567';

async function readStoredSignalChannelId(): Promise<string> {
  const snapshot = await db.collection('servers').doc(SERVER_ID).collection('channels')
    .where('name', '==', SIGNAL_CHANNEL_NAME)
    .limit(1)
    .get();
  if (snapshot.empty) return '';
  const doc = snapshot.docs[0];
  const data = doc.data() || {};
  return String(data.id || doc.id || '').trim();
}

async function rememberSignalChannel(channelId: string, channel: any = {}): Promise<void> {
  await db.collection('servers').doc(SERVER_ID).collection('channels').doc(channelId).set({
    id: channelId,
    name: SIGNAL_CHANNEL_NAME,
    type: Number(channel?.type ?? 0),
    position: Number(channel?.position || 0),
    parentId: channel?.parent_id || null,
  }, { merge: true }).catch(() => {});
}

async function verifyCanonicalSignalChannelId(): Promise<string> {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) {
    // The ID is an operator-provided stable Discord snowflake. If the bot token is
    // temporarily unavailable, prefer the known destination over failing Signal.
    return SIGNAL_CHANNEL_ID;
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${SIGNAL_CHANNEL_ID}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5000)
      : undefined,
  });
  if (!response.ok) return '';

  const channel = await response.json().catch(() => null) as any;
  if (!channel || String(channel.guild_id || '') !== SERVER_ID) return '';

  await rememberSignalChannel(SIGNAL_CHANNEL_ID, channel);
  return SIGNAL_CHANNEL_ID;
}

async function fetchSignalChannelIdFromDiscord(): Promise<string> {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) return '';

  const response = await fetch(`https://discord.com/api/v10/guilds/${SERVER_ID}/channels`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5000)
      : undefined,
  });
  if (!response.ok) return '';

  const channels = await response.json().catch(() => []) as any[];
  const match = channels.find((channel) =>
    Number(channel?.type) === 0 && String(channel?.name || '').toLowerCase() === SIGNAL_CHANNEL_NAME,
  );
  const channelId = String(match?.id || '').trim();
  if (!channelId) return '';

  await rememberSignalChannel(channelId, match);
  return channelId;
}

export async function GET(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Prefer the known canonical destination first. Stored/name-based discovery
    // remains as recovery for a future channel migration.
    const canonical = await verifyCanonicalSignalChannelId();
    const stored = canonical ? '' : await readStoredSignalChannelId();
    const channelId = canonical || stored || await fetchSignalChannelIdFromDiscord();
    if (!channelId) {
      return NextResponse.json({
        error: `${SIGNAL_CHANNEL_NAME} was not found in the Space Mountain Discord`,
        guildId: SERVER_ID,
        channelName: SIGNAL_CHANNEL_NAME,
        canonicalChannelId: SIGNAL_CHANNEL_ID,
      }, { status: 404 });
    }

    return NextResponse.json({
      source: 'discord-stream-hub',
      kind: 'signal-destination',
      guildId: SERVER_ID,
      channelId,
      channelName: SIGNAL_CHANNEL_NAME,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[API /internal/signal/channel]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
