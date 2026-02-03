'use server';

import puppeteer from 'puppeteer';
import { uploadFileToFirebase } from './firebase-storage-service';

export async function generateCommunityCard(
  serverId: string,
  streamerName: string,
  streamData: any
): Promise<string | null> {
  let browser;
  
  try {
    console.log(`[CommunityCard] Generating card for ${streamerName}`);
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 360 });

    // Build URL with stream data
    const params = new URLSearchParams({
      streamer: streamerName,
      title: streamData.title || 'Live Stream',
      game: streamData.game || 'Just Chatting',
      viewers: streamData.viewers?.toString() || '0',
      avatar: streamData.avatarUrl || '',
      thumbnail: streamData.thumbnailUrl || '',
      live: streamData.isLive ? 'true' : 'false'
    });

    const appUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
    const cardUrl = `${appUrl}/headless/community-card/${serverId}?${params.toString()}`;
    console.log(`[CommunityCard] Navigating to ${cardUrl}`);

    await page.goto(cardUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for content to load
    await page.waitForSelector('main', { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false
    });

    // Upload to Firebase Storage
    const timestamp = Date.now();
    const fileName = `community_cards/${streamerName}_${timestamp}.png`;
    const downloadUrl = await uploadFileToFirebase(screenshot, fileName, 'image/png');

    console.log(`[CommunityCard] Generated card: ${downloadUrl}`);
    return downloadUrl;

  } catch (error) {
    console.error(`[CommunityCard] Error generating card for ${streamerName}:`, error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}