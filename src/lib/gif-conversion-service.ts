'use server';

import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, writeFile, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import puppeteer from 'puppeteer';
import { getClipVideoUrl } from './clip-url-finder';
import { getStoragePath } from './runtime-config';

const execAsync = promisify(exec);
const STORAGE_PATH = getStoragePath();

export interface GifConversionOptions {
  serverId?: string;
  fallbackGifUrl?: string;
}

// Queue system to prevent multiple conversions at once
let conversionQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || conversionQueue.length === 0) return;
  
  isProcessingQueue = true;
  while (conversionQueue.length > 0) {
    const task = conversionQueue.shift();
    if (task) {
      try {
        await task();
      } catch (error) {
        console.error('[GifConversion] Queue task error:', error);
      }
    }
  }
  isProcessingQueue = false;
}

export async function convertClipToGif(
  clipUrl: string,
  clipId: string,
  streamerName: string,
  duration: number = 60,
  contentType: 'stream' | 'header' | 'footer' = 'stream',
  options: GifConversionOptions = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    conversionQueue.push(async () => {
      const result = await convertClipToGifInternal(clipUrl, clipId, streamerName, duration, contentType, options);
      resolve(result);
    });
    processQueue();
  });
}

async function convertClipToGifInternal(
  clipUrl: string,
  clipId: string,
  streamerName: string,
  duration: number,
  contentType: 'stream' | 'header' | 'footer',
  options: GifConversionOptions
): Promise<string | null> {
  const tempGif = join(tmpdir(), `${clipId}.gif`);
  const tempMp4 = join(tmpdir(), `${clipId}.mp4`);
  const fps = 12;

  try {
    console.log(`[GifConversion] Converting clip for ${streamerName}`);
    
    // Try GraphQL API first (fast)
    let mp4Url: string | null = null;
    let authToken: string | undefined;
    let authSignature: string | undefined;
    
    const urlData = await getClipVideoUrl(clipUrl);
    if (urlData) {
      if (typeof urlData === 'string') {
        mp4Url = urlData;
      } else {
        mp4Url = urlData.url;
        authToken = urlData.token;
        authSignature = urlData.signature;
      }
      console.log(`[GifConversion] Got URL from GraphQL`);
    }
    
    // Fallback to Puppeteer if GraphQL fails
    if (!mp4Url) {
      console.log(`[GifConversion] GraphQL failed, trying Puppeteer...`);
      mp4Url = await getUrlWithPuppeteer(clipUrl);
    }
    
    if (!mp4Url) {
      console.log(`[GifConversion] Could not get video URL for ${clipId}`);
      return null;
    }

    console.log(`[GifConversion] Downloading MP4...`);
    
    // Build URL with auth params if available
    let downloadUrl = mp4Url;
    if (authToken && authSignature) {
      const urlObj = new URL(mp4Url);
      urlObj.searchParams.set('sig', authSignature);
      urlObj.searchParams.set('token', authToken);
      downloadUrl = urlObj.toString();
    }
    
    const mp4Response = await fetch(downloadUrl, {
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.twitch.tv/',
        'Origin': 'https://www.twitch.tv'
      }
    });
    
    if (!mp4Response.ok) {
      console.log(`[GifConversion] Failed to download MP4: ${mp4Response.status}`);
      return null;
    }
    
    const mp4Buffer = Buffer.from(await mp4Response.arrayBuffer());
    await writeFile(tempMp4, mp4Buffer);
    console.log(`[GifConversion] Downloaded ${mp4Buffer.length} bytes`);
    
    // Convert MP4 to GIF
    console.log(`[GifConversion] Converting to GIF...`);
    const palettePath = join(tmpdir(), `${clipId}_palette.png`);
    await execAsync(`ffmpeg -y -i "${tempMp4}" -vf "fps=${fps},scale=480:-1:flags=lanczos,palettegen" "${palettePath}"`);
    await execAsync(`ffmpeg -y -i "${tempMp4}" -i "${palettePath}" -filter_complex "fps=${fps},scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${tempGif}"`);
    
    // Store the GIF
    const streamerDir = join(STORAGE_PATH, streamerName);
    if (!existsSync(streamerDir)) {
      await mkdir(streamerDir, { recursive: true });
    }

    // Enforce 10 GIF limit BEFORE writing new file to prevent ENOSPC
    const { readdir: readdirCleanup, unlink: unlinkFile } = await import('fs/promises');
    const existingFiles = await readdirCleanup(streamerDir);
    const existingGifs = existingFiles.filter(f => f.endsWith('.gif')).sort();
    if (existingGifs.length >= 5) {
      const toDelete = existingGifs.slice(0, existingGifs.length - 4);
      for (const file of toDelete) {
        await unlinkFile(join(streamerDir, file)).catch(() => {});
      }
    }

    const timestamp = Date.now();
    const gifStoragePath = join(streamerDir, `${timestamp}.gif`);
    const gifBuffer = await readFile(tempGif);
    await writeFile(gifStoragePath, gifBuffer);
    const gifUrl = `/api/media/${streamerName}/${timestamp}.gif`;

    await unlink(palettePath).catch(() => {});
    await unlink(tempGif).catch(() => {});
    await unlink(tempMp4).catch(() => {});

    console.log(`[GifConversion] ✅ Success: ${gifUrl}`);
    return gifUrl;

  } catch (error) {
    console.error(`[GifConversion] Error for ${streamerName}:`, error);
    await unlink(tempGif).catch(() => {});
    await unlink(tempMp4).catch(() => {});
    return null;
  }
}

async function getUrlWithPuppeteer(clipUrl: string): Promise<string | null> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    let mp4Url: string | null = null;
    
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('.mp4') && !mp4Url) {
        mp4Url = url;
      }
    });
    
    await page.goto(clipUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('video', { timeout: 10000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return mp4Url;
  } catch (error) {
    console.error(`[Puppeteer] Error:`, error);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
