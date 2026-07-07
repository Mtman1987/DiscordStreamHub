import { NextRequest, NextResponse } from 'next/server';
import { generateLeaderboardImage } from '@/ai/flows/generate-leaderboard-image';
import { saveFile } from '@/lib/local-storage-service';
import { getAppUrl } from '@/lib/runtime-config';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId } = await request.json();

    if (!serverId || !channelId) {
      return NextResponse.json({ success: false, error: 'Missing serverId or channelId' }, { status: 400 });
    }

    const leaderboardImage = await generateLeaderboardImage(serverId);
    if (!leaderboardImage) {
      return NextResponse.json({ success: false, error: 'Failed to generate leaderboard image' }, { status: 500 });
    }

    // Save the generated image to local storage so it can be served from /api/media
    const base64Data = leaderboardImage.replace(/^data:image\/png;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const fileName = `leaderboard-images/${serverId}/leaderboard-${Date.now()}.png`;
    const imageUrl = await saveFile(fileName, imageBuffer);
    const publicBaseUrl = (getAppUrl() || request.nextUrl.origin).replace(/\/$/, '');
    const publicImageUrl = imageUrl.startsWith('http') ? imageUrl : `${publicBaseUrl}${imageUrl}`;

    const embed = {
      title: '🏆 Community Leaderboard',
      description: 'Top contributors in the community.',
      color: 0x667eea,
      image: { url: publicImageUrl },
      timestamp: new Date().toISOString(),
    };

    const components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: 'Check My Rank',
            custom_id: `check_rank_${serverId}`,
          },
        ],
      },
    ];

    const botToken = process.env.DISCORD_BOT_TOKEN;
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed],
        components
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${error}`);
    }

    return NextResponse.json({ success: true, message: 'Leaderboard posted to Discord' });
  } catch (error) {
    console.error('Failed to post leaderboard:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
