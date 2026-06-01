'use server';

import puppeteer from 'puppeteer';
import { getAppUrl } from '@/lib/runtime-config';

export async function generateLeaderboardImage(
  guildId: string
): Promise<string | null> {
  try {
    const baseUrl = getAppUrl() || 'http://localhost:3000';
    const url = `${baseUrl}/headless/leaderboard/${guildId}`;
    
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.leaderboard', { timeout: 20000 });
    await page.waitForFunction(() => {
      const root = document.querySelector('.leaderboard');
      return Boolean(root && root.querySelector('.leaderboard-entry'));
    }, { timeout: 20000 });
    
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    await browser.close();
    
    return `data:image/png;base64,${screenshot.toString('base64')}`;
  } catch (error) {
    console.error(`[generateLeaderboardImage] Failed:`, error);
    return null;
  }
}
