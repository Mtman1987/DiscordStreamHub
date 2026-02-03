import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Only run in local Electron mode
  if (!process.env.ELECTRON_MODE) {
    return NextResponse.json({ error: 'Not available in hosted mode' }, { status: 404 });
  }

  try {
    const { username, contentType } = await request.json();
    
    // Use local Puppeteer/FFmpeg services
    const { convertClipToGif } = await import('@/lib/gif-conversion-service');
    const { getTwitchUserClips } = await import('@/lib/twitch-api-service');
    
    // Get latest clip for user
    const clips = await getTwitchUserClips(username, 1);
    if (!clips.length) {
      return NextResponse.json({ error: 'No clips found' }, { status: 404 });
    }
    
    const clipUrl = clips[0].url;
    const gifUrl = await convertClipToGif(
      clipUrl, 
      clips[0].id, 
      username, 
      10, 
      contentType === 'spotlight' ? 'stream' : 'stream'
    );
    
    if (!gifUrl) {
      return NextResponse.json({ error: 'Failed to generate GIF' }, { status: 500 });
    }
    
    return NextResponse.json({ gifUrl });
    
  } catch (error) {
    console.error('Local GIF generation error:', error);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}