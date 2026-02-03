'use server';

import { NextRequest, NextResponse } from 'next/server';
import { generateCalendarImage } from '@/ai/flows/generate-calendar-image';
import { Buffer } from 'node:buffer';

async function postToDiscord(channelId: string, botToken: string, calendarImage: string) {
    const match = calendarImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
        throw new Error('Invalid image data URL for calendar.');
    }
    const [, mime, base64] = match;
    const attachment = {
        buffer: Buffer.from(base64, 'base64'),
        mime,
        filename: 'calendar.png',
    };

    const payload = {
        embeds: [{
            title: '📅 Community Calendar',
            description: 'Here is the latest schedule of events for the community!',
            color: 0x5865F2, // Discord Blurple
            image: { url: 'attachment://calendar.png' },
            timestamp: new Date().toISOString(),
        }],
        attachments: [{
            id: 0,
            filename: attachment.filename,
            description: 'Community Calendar Snapshot'
        }]
    };

    const formData = new FormData();
    formData.append('payload_json', JSON.stringify(payload));
    formData.append('files[0]', new Blob([attachment.buffer], { type: attachment.mime }), attachment.filename);

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}` },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Discord API responded with ${response.status}: ${errorText}`);
    }
    return response.json();
}


export async function POST(req: NextRequest) {
  try {
    const { serverId, channelId } = await req.json();

    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Server ID and Channel ID are required.' }, { status: 400 });
    }
    
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
        throw new Error('DISCORD_BOT_TOKEN is not configured on the server.');
    }

    // This now directly calls the simplified image generator
    const calendarImage = await generateCalendarImage(serverId);
    if (!calendarImage) {
        throw new Error('Failed to generate the calendar image.');
    }

    // This logic is now self-contained, just like the working leaderboard route
    await postToDiscord(channelId, botToken, calendarImage);

    return NextResponse.json({ message: 'Calendar successfully dispatched to Discord.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[Dispatch Calendar Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
