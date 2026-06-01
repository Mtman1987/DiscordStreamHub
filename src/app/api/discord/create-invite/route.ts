import { NextRequest, NextResponse } from 'next/server';
import { getDiscordShoutoutChannelId } from '@/lib/runtime-config';

export async function POST(request: NextRequest) {
  try {
    const { channelId } = await request.json();
    const targetChannelId = channelId || getDiscordShoutoutChannelId();
    if (!targetChannelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
    }
    
    const response = await fetch(`https://discord.com/api/v10/channels/${targetChannelId}/invites`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        max_age: 0,
        max_uses: 0,
        temporary: false,
        unique: false
      })
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    const invite = await response.json();
    const inviteUrl = `https://discord.gg/${invite.code}`;
    
    return NextResponse.json({ 
      success: true, 
      inviteUrl,
      code: invite.code 
    });

  } catch (error) {
    console.error('Error creating Discord invite:', error);
    return NextResponse.json({ 
      error: 'Failed to create invite'
    }, { status: 500 });
  }
}
