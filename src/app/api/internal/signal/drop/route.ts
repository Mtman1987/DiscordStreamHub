import { NextRequest, NextResponse } from 'next/server';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { postSignalDrop } from '@/lib/signal-seeker-service';

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const input = await request.json().catch(() => ({}));
  const guildId = String(input.guildId || '').trim();
  const channelId = String(input.channelId || '').trim();
  const channelName = String(input.channelName || channelId).trim();
  const clue = String(input.clue || '').trim().slice(0, 1800);
  const botName = String(input.botName || 'StreamWeaver').trim().slice(0, 80);
  const avatarUrl = String(input.avatarUrl || '').trim();
  if (!guildId || !channelId || !clue) {
    return NextResponse.json({ error: 'guildId, channelId, and clue are required' }, { status: 400 });
  }
  try {
    const posted = await postSignalDrop({
      guildId,
      channelId,
      channelName,
      clue,
      botName,
      avatarUrl,
      source: 'internal',
    });
    return NextResponse.json({ ok: true, dropId: posted.dropId, messageId: posted.messageId, expiresAt: posted.expiresAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Discord Signal post failed' }, { status: 502 });
  }
}
