'use server';

import { NextRequest, NextResponse } from 'next/server';
import { manuallyLinkTwitchAccount } from '@/lib/twitch-linking-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, discordUserId, twitchLogin } = await request.json();

    if (!serverId || !discordUserId || !twitchLogin) {
      return NextResponse.json({ error: 'Server ID, Discord User ID, and Twitch login are required' }, { status: 400 });
    }

    const success = await manuallyLinkTwitchAccount(serverId, discordUserId, twitchLogin);

    if (success) {
      return NextResponse.json({ success: true, message: 'Twitch account linked successfully' });
    } else {
      return NextResponse.json({ error: 'Failed to link Twitch account' }, { status: 500 });
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/link-manual]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
