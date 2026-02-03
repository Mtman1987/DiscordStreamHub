import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Only run in local Electron mode
  if (!process.env.ELECTRON_MODE) {
    return NextResponse.json({ error: 'Not available in hosted mode' }, { status: 404 });
  }

  try {
    const { username, contentType } = await request.json();
    
    // Use local Puppeteer for screenshots
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({ headless: true });
    const page = await browser.newPage();
    
    let screenshotUrl: string;
    
    switch (contentType) {
      case 'calendar':
        screenshotUrl = `http://localhost:3300/headless/calendar`;
        break;
      case 'leaderboard':
        screenshotUrl = `http://localhost:3300/headless/leaderboard`;
        break;
      default:
        screenshotUrl = `https://twitch.tv/${username}`;
    }
    
    await page.goto(screenshotUrl, { waitUntil: 'networkidle0' });
    await page.setViewport({ width: 1920, height: 1080 });
    
    const screenshot = await page.screenshot({ 
      type: 'png',
      fullPage: false
    });
    
    await browser.close();
    
    // Upload to Firebase Storage
    const { uploadToStorage } = await import('@/lib/firebase-storage-service');
    const storagePath = `images/${username}_${contentType}_${Date.now()}.png`;
    const imageUrl = await uploadToStorage(screenshot, storagePath, 'image/png');
    
    return NextResponse.json({ imageUrl });
    
  } catch (error) {
    console.error('Local image generation error:', error);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}