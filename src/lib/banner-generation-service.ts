'use server';

import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { storage } from '@/firebase/server-init';

const execAsync = promisify(exec);

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

export async function generateCommanderBanner(): Promise<string> {
  console.log('[BannerGen] Generating commander banner...');
  
  const htmlPath = join(process.cwd(), 'public', 'banner-commander.html');
  const gifUrl = await recordBannerToGif(htmlPath, 'mtman1987');
  
  console.log(`[BannerGen] ✅ Commander banner: ${gifUrl}`);
  return gifUrl;
}

async function recordBannerToGif(htmlPath: string, username: string): Promise<string> {
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
    
    // Wait for animations to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Capture frames
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
    
    // Convert to GIF
    await execAsync(`ffmpeg -y -framerate ${fps} -i "${join(tmpdir(), `banner_${username}_frame_%03d.png`)}" -vf "palettegen" "${palettePath}"`);
    await execAsync(`ffmpeg -y -framerate ${fps} -i "${join(tmpdir(), `banner_${username}_frame_%03d.png`)}" -i "${palettePath}" -filter_complex "paletteuse" "${tempGif}"`);
    
    // Upload to Firebase
    const storagePath = `banners/${username}.gif`;
    const bucket = storage.bucket();
    await bucket.upload(tempGif, {
      destination: storagePath,
      metadata: { contentType: 'image/gif' }
    });
    
    const file = bucket.file(storagePath);
    await file.makePublic();
    const gifUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    
    // Cleanup
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
