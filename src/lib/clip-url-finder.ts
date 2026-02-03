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
  // Always use Puppeteer to scrape the real URL from the page
  try {
    console.log(`[ClipUrlFinder] Scraping video URL from: ${clipUrl}`);
    
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.goto(clipUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('video', { timeout: 10000 });
    
    // Get the video src from the page
    const videoUrl = await page.evaluate(() => {
      const video = document.querySelector('video');
      return video?.src || video?.querySelector('source')?.src;
    });
    
    await browser.close();
    
    if (!videoUrl) throw new Error('No video URL found');
    
    // Decode HTML entities (&amp; -> &)
    const decodedUrl = videoUrl.replace(/&amp;/g, '&');
    
    console.log(`[ClipUrlFinder] Found URL: ${decodedUrl}`);
    return decodedUrl;
  } catch (error) {
    console.error(`[ClipUrlFinder] Error:`, error);
    return null;
  }
}
