import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { isCommunityGroup } from '@/lib/group-utils';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

const SERVER_ID = getHardcodedGuildId();

function normalizeTwitchLogin(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9_]/gi, '')
    .toLowerCase()
    .slice(0, 25);
}

export async function GET(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await db.collection('servers').doc(SERVER_ID).collection('users').get();
    const channels = Array.from(new Set(
      snapshot.docs
        .map((doc: { data: () => any }) => doc.data())
        .filter((user: any) => isCommunityGroup(user?.group))
        .map((user: any) => normalizeTwitchLogin(user?.twitchLogin || user?.username || user?.displayName))
        .filter(Boolean),
    )).sort();

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
