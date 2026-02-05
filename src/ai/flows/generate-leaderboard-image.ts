'use server';

import puppeteer from 'puppeteer';

export async function generateLeaderboardImage(
  guildId: string
): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const url = `${baseUrl}/headless/leaderboard/${guildId}`;
    
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('.leaderboard', { timeout: 10000 });
    
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    await browser.close();
    
    return `data:image/png;base64,${screenshot.toString('base64')}`;
  } catch (error) {
    console.error(`[generateLeaderboardImage] Failed:`, error);
    return null;
  }
}
