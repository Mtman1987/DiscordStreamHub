'use server';

import path from 'path';

let findClipFileUrl: any = null;

// Only initialize Puppeteer if available (local dev)
try {
  const twitchUrlFinder = require(path.join(process.cwd(), 'twitch-video-url-finder-master', 'index.js'));
  findClipFileUrl = twitchUrlFinder(
    process.platform === 'win32' 
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : '/usr/bin/google-chrome-stable',
    ['--no-sandbox', '--disable-setuid-sandbox']
  );
  console.log('[ClipUrlFinder] Puppeteer initialized');
} catch (error) {
  console.log('[ClipUrlFinder] Puppeteer not available, will use fallback');
}

export async function getClipVideoUrl(clipUrl: string): Promise<string | null> {
  try {
    // Extract clip slug from URL (e.g., https://www.twitch.tv/username/clip/ClipSlug)
    const clipSlug = clipUrl.split('/clip/')[1]?.split('?')[0];
    if (!clipSlug) throw new Error('Invalid clip URL');
    
    console.log(`[ClipUrlFinder] Getting video URL for clip: ${clipSlug}`);
    
    // Use Twitch API to get clip info
    const twitchClientId = process.env.TWITCH_CLIENT_ID;
    const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
    
    if (!twitchClientId || !twitchClientSecret) {
      throw new Error('Twitch credentials not configured');
    }
    
    // Get OAuth token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${twitchClientId}&client_secret=${twitchClientSecret}&grant_type=client_credentials`
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    // Get clip data
    const clipResponse = await fetch(`https://api.twitch.tv/helix/clips?id=${clipSlug}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id': twitchClientId
      }
    });
    const clipData = await clipResponse.json();
    
    if (!clipData.data || clipData.data.length === 0) {
      throw new Error('Clip not found');
    }
    
    const thumbnailUrl = clipData.data[0].thumbnail_url;
    // Convert thumbnail URL to video URL by removing -preview and adding .mp4
    const videoUrl = thumbnailUrl.split('-preview-')[0] + '.mp4';
    
    console.log(`[ClipUrlFinder] Found URL: ${videoUrl}`);
    return videoUrl;
  } catch (error) {
    console.error(`[ClipUrlFinder] Error:`, error);
    return null;
  }
}
