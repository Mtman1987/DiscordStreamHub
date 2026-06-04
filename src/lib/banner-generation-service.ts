'use server';

import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { getStoragePath } from './runtime-config';

const execAsync = promisify(exec);
const STORAGE_PATH = getStoragePath();
const BANNER_VERSION = '2026-05-02-1';

export async function generateCrewBanners(crewMembers: string[]): Promise<void> {
  console.log('[BannerGen] Generating crew banners...');
  
  const templatePath = join(process.cwd(), 'public', 'banner-crew.html');
  const template = await readFile(templatePath, 'utf-8');
  
  for (const username of crewMembers) {
    try {
      console.log(`[BannerGen] Creating banner for ${username}`);
      
      const html = template.replace(/{{USERNAME}}/g, username.toUpperCase());
      const tempHtmlPath = join(tmpdir(), `banner_${username}.html`);
      await writeFile(tempHtmlPath, html);
      
      const gifUrl = await recordBannerToGif(tempHtmlPath, username);
      
      await unlink(tempHtmlPath).catch(() => {});
      
      console.log(`[BannerGen] ✅ ${username}: ${gifUrl}`);
    } catch (error) {
      console.error(`[BannerGen] Error for ${username}:`, error);
    }
  }
  
  console.log('[BannerGen] 🎉 All crew banners generated!');
}

export async function getCrewBannerUrl(username: string): Promise<string | null> {
  const bannerKey = username.toLowerCase();
  const bannersDir = join(STORAGE_PATH, 'banners');
  const bannerPath = join(bannersDir, `${bannerKey}.gif`);
  const metaPath = join(bannersDir, `${bannerKey}.gif.meta.json`);
  const bannerUrl = `/api/media/banners/${bannerKey}.gif?v=${BANNER_VERSION}`;

  try {
    if (!existsSync(bannersDir)) {
      await mkdir(bannersDir, { recursive: true });
    }

    if (!existsSync(bannerPath)) {
      return null;
    }

    try {
      const raw = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw) as { version?: string };
      if (meta.version && meta.version !== BANNER_VERSION) {
        console.log(`[BannerGen] Banner for ${username} is stale (version ${meta.version}); worker should refresh it`);
      }
    } catch {
      console.log(`[BannerGen] Banner meta missing for ${username}; worker should refresh it`);
    }

    return bannerUrl;
  } catch (error) {
    console.error(`[BannerGen] Failed to resolve banner for ${username}:`, error);
  }

  return null;
}

export async function generateCommanderBanner(): Promise<string> {
  console.log('[BannerGen] Generating commander banner...');
  
  const htmlPath = join(process.cwd(), 'public', 'banner-commander.html');
  const gifUrl = await recordBannerToGif(htmlPath, 'mtman1987');
  
  console.log(`[BannerGen] ✅ Commander banner: ${gifUrl}`);
  return gifUrl;
}

async function recordBannerToGif(htmlPath: string, username: string): Promise<string> {
  const bannerKey = username.toLowerCase();
  const tempGif = join(tmpdir(), `banner_${username}.gif`);
  const palettePath = join(tmpdir(), `banner_${username}_palette.png`);
  const fps = 30;
  const duration = 10;
  
  let browser;
  const framePaths: string[] = [];
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 200 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const frameCount = Math.floor(duration * fps);
    for (let i = 0; i < frameCount; i++) {
      const framePath = join(tmpdir(), `banner_${username}_frame_${i.toString().padStart(3, '0')}.png`);
      const screenshot = await page.screenshot({ type: 'png' });
      await writeFile(framePath, screenshot);
      framePaths.push(framePath);
      await new Promise(resolve => setTimeout(resolve, 1000 / fps));
    }
    
    await browser.close();
    browser = null;
    
    await execAsync(`ffmpeg -y -framerate ${fps} -i "${join(tmpdir(), `banner_${username}_frame_%03d.png`)}" -vf "palettegen" "${palettePath}"`);
    await execAsync(`ffmpeg -y -framerate ${fps} -i "${join(tmpdir(), `banner_${username}_frame_%03d.png`)}" -i "${palettePath}" -filter_complex "paletteuse" "${tempGif}"`);
    
    const bannersDir = join(STORAGE_PATH, 'banners');
    if (!existsSync(bannersDir)) {
      await mkdir(bannersDir, { recursive: true });
    }
    
    const storagePath = join(bannersDir, `${bannerKey}.gif`);
    const metaPath = join(bannersDir, `${bannerKey}.gif.meta.json`);
    const gifBuffer = await readFile(tempGif);
    await writeFile(storagePath, gifBuffer);
    await writeFile(metaPath, JSON.stringify({
      version: BANNER_VERSION,
      generatedAt: new Date().toISOString()
    }, null, 2));
    const gifUrl = `/api/media/banners/${bannerKey}.gif`;
    
    for (const fp of framePaths) await unlink(fp).catch(() => {});
    await unlink(palettePath).catch(() => {});
    await unlink(tempGif).catch(() => {});
    
    return gifUrl;
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    for (const fp of framePaths) await unlink(fp).catch(() => {});
    throw error;
  }
}
