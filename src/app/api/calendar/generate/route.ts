import { NextRequest, NextResponse } from 'next/server';
import {
  uploadCalendarImageFromGenerator,
  buildCalendarButtons,
  storeCalendarMessageMeta,
  generateCalendarEmbeds,
} from '@/lib/calendar-discord-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId, includeButtons = false } = await request.json();

    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Server ID and Channel ID are required' }, { status: 400 });
    }

    const monthOffset = 0;
    const imageUrl = await uploadCalendarImageFromGenerator(serverId, monthOffset);
    const { missionEmbed, calendarEmbed } = await generateCalendarEmbeds(serverId, imageUrl);

    const messagePayload: any = {
      embeds: [missionEmbed, calendarEmbed],
    };

    if (includeButtons) {
      messagePayload.components = buildCalendarButtons(serverId);
    }

    const discordResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagePayload),
    });

    if (!discordResponse.ok) {
      const errorData = await discordResponse.text();
      const status = discordResponse.status === 404 && /Unknown Channel|10003/i.test(errorData) ? 400 : 500;
      if (status >= 500) {
        console.error('Discord API error:', errorData);
      }
      const hint = status === 400 ? 'The configured Discord calendar channel is missing or the bot cannot access it. Pick a valid channel and try again.' : undefined;
      return NextResponse.json({ error: 'Failed to post to Discord', details: errorData, hint }, { status });
    }

    const message = await discordResponse.json();

    await storeCalendarMessageMeta(serverId, {
      channelId,
      messageId: message.id,
      includeButtons,
      lastImageUrl: imageUrl ?? undefined,
      monthOffset,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Calendar generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
