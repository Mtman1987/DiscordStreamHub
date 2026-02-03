'use server';

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { channelId, content } = await request.json();

    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
        { status: 400 }
      );
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json(
        { error: 'Bot token not configured on the server.' },
        { status: 500 }
      );
    }

    const discordApiEndpoint = `https://discord.com/api/v10/channels/${channelId}/messages`;

    const response = await fetch(discordApiEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: content || 'Hello from Firebase Studio! The bot is connected. ✅' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[API/POST] Discord API Error: ${response.status}`,
        errorText
      );
      return NextResponse.json(
        { error: `Failed to send message: ${errorText}` },
        { status: response.status }
      );
    }

    const responseData = await response.json();
    return NextResponse.json({ success: true, messageId: responseData.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[API/POST] Internal Server Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
