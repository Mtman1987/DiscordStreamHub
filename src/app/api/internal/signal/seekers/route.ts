import { NextRequest, NextResponse } from 'next/server';
import { getDiscordInviteUrl, getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { findDiscordMemberByTwitch, setSignalSeekerMembership } from '@/lib/signal-seeker-service';

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const input = await request.json().catch(() => ({}));
  const guildId = String(input.guildId || getHardcodedGuildId()).trim();
  const twitchUserId = String(input.twitchUserId || '').trim();
  const twitchUsername = String(input.twitchUsername || '').trim().toLowerCase();
  const action = ['join', 'leave'].includes(String(input.action)) ? input.action : 'toggle';
  if (!guildId || (!twitchUserId && !twitchUsername)) {
    return NextResponse.json({ error: 'A Twitch identity is required' }, { status: 400 });
  }
  const discordUserId = await findDiscordMemberByTwitch(guildId, twitchUserId, twitchUsername);
  if (!discordUserId) {
    return NextResponse.json({ ok: true, linked: false, inviteUrl: getDiscordInviteUrl() });
  }
  try {
    const membership = await setSignalSeekerMembership({ guildId, discordUserId, action });
    return NextResponse.json({ ok: true, linked: true, ...membership });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      linked: false,
      inviteUrl: getDiscordInviteUrl(),
      reason: error instanceof Error ? error.message : 'Discord membership unavailable',
    });
  }
}
