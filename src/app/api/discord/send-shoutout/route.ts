'use server';

import { NextRequest, NextResponse } from 'next/server';
import { sendShoutoutToDiscord } from '@/lib/shoutout-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId, twitchLogin, discordUserId } = await request.json();

    if (!serverId || !channelId || !twitchLogin || !discordUserId) {
      return NextResponse.json({
        error: 'Server ID, channel ID, Twitch login, and Discord user ID are required'
      }, { status: 400 });
    }

    // Get the user's group to determine shoutout type
    const { getUserGroup } = await import('@/lib/shoutout-service');
    const group = await getUserGroup(serverId, discordUserId);

    await sendShoutoutToDiscord({
      serverId,
      channelId,
      twitchLogin,
      group
    });

    return NextResponse.json({
      success: true,
      message: `Shoutout sent for ${twitchLogin} (${group})`
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/send-shoutout]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
