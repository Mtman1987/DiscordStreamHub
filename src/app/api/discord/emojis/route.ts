import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('serverId');

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID required' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    const response = await fetch(`https://discord.com/api/v10/guilds/${serverId}/emojis`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch emojis');
    }

    const emojis = await response.json();
    return NextResponse.json({ emojis });
  } catch (error) {
    console.error('Failed to fetch server emojis:', error);
    return NextResponse.json({ error: 'Failed to fetch emojis' }, { status: 500 });
  }
}
