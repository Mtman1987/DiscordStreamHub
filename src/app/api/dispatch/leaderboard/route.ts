'use server';

import { NextRequest, NextResponse } from 'next/server';
import { generateLeaderboardImage } from '@/ai/flows/generate-leaderboard-image';
import { Buffer } from 'node:buffer';

async function postToDiscord(channelId: string, botToken: string, leaderboardImage: string) {
    const match = leaderboardImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
        throw new Error('Invalid image data URL for leaderboard.');
    }
    const [, mime, base64] = match;
    const attachment = {
        buffer: Buffer.from(base64, 'base64'),
        mime,
        filename: 'leaderboard.png',
    };

    const payload = {
        embeds: [{
            title: '🏆 Community Leaderboard',
            description: 'Here are the current top contributors in the community!',
            color: 0xf1c40f,
            image: { url: 'attachment://leaderboard.png' },
            timestamp: new Date().toISOString(),
        }],
        attachments: [{
            id: 0,
            filename: attachment.filename,
            description: 'Community Leaderboard Snapshot'
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

    const leaderboardImage = await generateLeaderboardImage(serverId);
    if (!leaderboardImage) {
        throw new Error('Failed to generate the leaderboard image.');
    }

    await postToDiscord(channelId, botToken, leaderboardImage);

    return NextResponse.json({ message: 'Leaderboard successfully dispatched to Discord.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[Dispatch Leaderboard Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
