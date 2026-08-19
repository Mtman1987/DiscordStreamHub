import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

const SERVER_ID = getHardcodedGuildId();

function normalizeTwitchLogin(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .replace(/^#/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9_]/gi, '')
    .toLowerCase()
    .slice(0, 25);
}

async function getLiveShoutoutChannels(): Promise<string[]> {
  const serverRef = db.collection('servers').doc(SERVER_ID);
  const [usersSnapshot, blacklistSnapshot] = await Promise.all([
    serverRef.collection('users').get(),
    serverRef.collection('twitchChatBlacklist').get(),
  ]);

  const blacklistedChannels = new Set(
    blacklistSnapshot.docs
      .map((doc: { id: string; data: () => any }) => normalizeTwitchLogin(doc.data()?.channel || doc.id))
      .filter(Boolean),
  );

  const liveChannels: string[] = [];
  for (const doc of usersSnapshot.docs) {
    const shoutoutState = await doc.ref.collection('shoutoutState').doc('current').get();
    if (!shoutoutState.exists || shoutoutState.data()?.isLive !== true) continue;

    const channel = normalizeTwitchLogin(doc.data()?.twitchLogin);
    if (!channel || blacklistedChannels.has(channel)) continue;
    liveChannels.push(channel);
  }

  return Array.from(new Set(liveChannels)).sort();
}

export async function GET(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const channels = await getLiveShoutoutChannels();

    return NextResponse.json({
      source: 'discord-stream-hub',
      kind: 'signal-carriers',
      count: channels.length,
      channels,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[API /internal/signal/carriers]', message);
    return NextResponse.json({ error: message, channels: [] }, { status: 500 });
  }
}
