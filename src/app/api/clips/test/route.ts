import { NextRequest, NextResponse } from 'next/server';
import { getUserByLogin, getClipsForUser } from '@/lib/twitch-api-service';
import { getClipVideoUrl } from '@/lib/clip-url-finder';
import { convertClipToGif } from '@/lib/gif-conversion-service';

export async function POST(request: NextRequest) {
  try {
    const { twitchLogin } = await request.json();
    
    if (!twitchLogin) {
      return NextResponse.json({ error: 'twitchLogin required' }, { status: 400 });
    }

    console.log('[TestClip] Starting test for:', twitchLogin);
    
    // Step 1: Get Twitch user
    const twitchUser = await getUserByLogin(twitchLogin);
    if (!twitchUser) {
      return NextResponse.json({ error: 'Twitch user not found' }, { status: 404 });
    }
    console.log('[TestClip] Found user:', twitchUser.display_name);

    // Step 2: Get clips
    const clips = await getClipsForUser(twitchUser.id, 5);
    if (clips.length === 0) {
      return NextResponse.json({ error: 'No clips found' }, { status: 404 });
    }
    console.log('[TestClip] Found', clips.length, 'clips');
    
    const clip = clips[0];
    console.log('[TestClip] Testing clip:', clip.title);
    console.log('[TestClip] Clip URL:', clip.url);

    // Step 3: Convert to GIF directly from clip URL
    const gifUrl = await convertClipToGif(
      clip.url,  // Use MP4 URL with our custom player
      clip.id,
      twitchLogin,
      Math.min(clip.duration, 30),
      'stream',
      { serverId: '1240832965865635881' }
    );

    console.log('[TestClip] GIF URL:', gifUrl);

    return NextResponse.json({
      success: true,
      twitchUser: twitchUser.display_name,
      clipTitle: clip.title,
      clipUrl: clip.url,
      gifUrl,
      duration: clip.duration
    });
  } catch (error) {
    console.error('[TestClip] Error:', error);
    return NextResponse.json({ 
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
