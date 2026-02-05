import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import { app, db } from '@/firebase/server-init';
import { generateLeaderboardImage } from '@/ai/flows/generate-leaderboard-image';

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

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

    // Upload to Firebase Storage
    const base64Data = leaderboardImage.replace(/^data:image\/png;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const bucket = getStorage(app).bucket(STORAGE_BUCKET!);
    const fileName = `leaderboard-images/${serverId}/leaderboard-${Date.now()}.png`;
    const file = bucket.file(fileName);
    await file.save(imageBuffer, {
      metadata: { contentType: 'image/png' },
      public: true,
    });
    const imageUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${fileName}`;

    const components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: 'Check My Rank',
            custom_id: 'check_rank',
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
        content: imageUrl,
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
