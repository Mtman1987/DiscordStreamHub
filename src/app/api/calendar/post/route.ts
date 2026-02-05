import { NextRequest, NextResponse } from 'next/server';
import {
  uploadCalendarImageFromGenerator,
  generateCalendarEmbeds,
  buildCalendarButtons,
  storeCalendarMessageMeta,
} from '@/lib/calendar-discord-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId } = await request.json();
    
    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Server ID and Channel ID are required' }, { status: 400 });
    }

    const monthOffset = 0;
    const imageUrl = await uploadCalendarImageFromGenerator(serverId, monthOffset);
    const { calendarEmbed } = await generateCalendarEmbeds(serverId, imageUrl);
    const components = buildCalendarButtons(serverId);

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    const discordResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [calendarEmbed],
        components,
      }),
    });

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text();
      console.error('Discord API error:', errorText);
      return NextResponse.json({ error: 'Failed to post to Discord' }, { status: discordResponse.status });
    }

    const result = await discordResponse.json();

    await storeCalendarMessageMeta(serverId, {
      channelId,
      messageId: result.id,
      includeButtons: true,
      lastImageUrl: imageUrl,
      monthOffset,
    });

    return NextResponse.json({ success: true, messageId: result.id });

  } catch (error) {
    console.error('Calendar post error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
