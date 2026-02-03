import { NextRequest, NextResponse } from 'next/server';
import { generateShoutoutCardGif } from '@/lib/shoutout-card-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, streamerName, streamTitle, gameName, viewerCount, avatarUrl } = await request.json();
    
    if (!serverId || !streamerName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log(`Starting card recording for ${streamerName}...`);
    
    const cardResult = await generateShoutoutCardGif({
      streamerName,
      streamTitle: streamTitle || 'Live Stream',
      gameName: gameName || 'Just Chatting',
      viewerCount: viewerCount || 0,
      avatarUrl: avatarUrl || '',
      streamThumbnail: '',
      isLive: true,
      isMature: false
    }, serverId);
    
    if (!cardResult) {
      return NextResponse.json({ error: 'Failed to generate card recording' }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true,
      gifUrl: cardResult.gifUrl,
      mp4Url: cardResult.mp4Url,
      message: `Card recorded for ${streamerName}`
    });
  } catch (error) {
    console.error('Error recording card:', error);
    return NextResponse.json({ 
      error: 'Failed to record card',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
