import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

const SERVER_ID = getHardcodedGuildId();
const SIGNAL_CHANNEL_NAME = 'comms-lounge';

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

  await db.collection('servers').doc(SERVER_ID).collection('channels').doc(channelId).set({
    id: channelId,
    name: SIGNAL_CHANNEL_NAME,
    type: 0,
    position: Number(match?.position || 0),
    parentId: match?.parent_id || null,
  }, { merge: true }).catch(() => {});

  return channelId;
}

export async function GET(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stored = await readStoredSignalChannelId();
    const channelId = stored || await fetchSignalChannelIdFromDiscord();
    if (!channelId) {
      return NextResponse.json({
        error: `${SIGNAL_CHANNEL_NAME} was not found in the Space Mountain Discord`,
        guildId: SERVER_ID,
        channelName: SIGNAL_CHANNEL_NAME,
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
