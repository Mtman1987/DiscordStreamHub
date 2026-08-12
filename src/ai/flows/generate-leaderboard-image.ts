'use server';

import puppeteer from 'puppeteer';
import { getAppUrl, getPuppeteerExecutablePath } from '@/lib/runtime-config';
import { getServerBranding, type ServerBranding } from '@/lib/server-branding';

export async function generateLeaderboardImage(
  guildId: string,
  suppliedBranding?: ServerBranding,
): Promise<string | null> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    const baseUrl = getAppUrl() || 'http://localhost:3000';
    const branding = suppliedBranding || await getServerBranding(guildId);
    const url = new URL(`/headless/leaderboard/${encodeURIComponent(guildId)}`, baseUrl);
    url.searchParams.set('serverName', branding.serverName);
    url.searchParams.set('memberName', branding.communityMemberName);
    url.searchParams.set('memberNamePlural', branding.communityMemberNamePlural);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: getPuppeteerExecutablePath() || undefined,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1400, deviceScaleFactor: 1 });
    // The headless page keeps background requests alive, so networkidle0 can
    // time out even after the leaderboard is ready. Load the document and use
    // the rendered entry as the actual readiness signal instead.
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('.leaderboard-entry', { timeout: 20000 });

    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          opacity: 1 !important;
          transform: none !important;
        }
      `,
    });

    await page.evaluate(async () => {
      await document.fonts?.ready;
      const images = Array.from(document.images);
      await Promise.all(images.map(async (image) => {
        if (image.complete) return;
        await new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
      }));
    });

    const root = await page.$('.leaderboard');
    if (!root) throw new Error('Leaderboard root was not rendered');
    const screenshot = await root.screenshot({ type: 'png' });

    await browser.close();
    browser = null;
    return `data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`;
  } catch (error) {
    console.error('[generateLeaderboardImage] Failed:', error);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
