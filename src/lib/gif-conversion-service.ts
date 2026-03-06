'use server';

import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, writeFile, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import puppeteer from 'puppeteer';
import { getClipVideoUrl } from './clip-url-finder';

const execAsync = promisify(exec);
const STORAGE_PATH = process.env.STORAGE_PATH || '/data/clips';

export interface GifConversionOptions {
  serverId?: string;
  fallbackGifUrl?: string;
}

export async function convertClipToGif(
  clipUrl: string,
  clipId: string,
  streamerName: string,
  duration: number = 60,
  contentType: 'stream' | 'header' | 'footer' = 'stream',
  options: GifConversionOptions = {}
): Promise<string | null> {
  const tempGif = join(tmpdir(), `${clipId}.gif`);
  const tempMp4 = join(tmpdir(), `${clipId}.mp4`);
  const maxDuration = Math.min(duration, 60);
  const fps = 15;

  let browser;
  const framePaths: string[] = [];
  
  try {
    console.log(`[GifConversion] Recording clip for ${streamerName}`);
    
    const mp4Url = await getClipVideoUrl(clipUrl);
    if (!mp4Url) throw new Error('Failed to get video URL');
    console.log(`[GifConversion] Downloading MP4...`);
    
    const mp4Response = await fetch(mp4Url);
    if (!mp4Response.ok) throw new Error(`Failed to download MP4: ${mp4Response.status}`);
    const mp4Buffer = Buffer.from(await mp4Response.arrayBuffer());
    await writeFile(tempMp4, mp4Buffer);
    console.log(`[GifConversion] Downloaded ${mp4Buffer.length} bytes`);
    
    console.log(`[GifConversion] Uploading MP4 to local storage...`);
    const streamerDir = join(STORAGE_PATH, streamerName);
    if (!existsSync(streamerDir)) {
      await mkdir(streamerDir, { recursive: true });
    }
    const mp4StoragePath = join(streamerDir, `${clipId}.mp4`);
    await writeFile(mp4StoragePath, mp4Buffer);
    const cleanMp4Url = `/api/media/${streamerName}/${clipId}.mp4`;
    console.log(`[GifConversion] Clean MP4 URL: ${cleanMp4Url}`);
    
    console.log(`[GifConversion] Converting MP4 to GIF with FFmpeg...`);
    
    const palettePath = join(tmpdir(), `${clipId}_palette.png`);
    await execAsync(`ffmpeg -y -i "${tempMp4}" -vf "fps=${fps},scale=400:-1:flags=lanczos,palettegen" "${palettePath}"`);
    await execAsync(`ffmpeg -y -t ${maxDuration} -i "${tempMp4}" -i "${palettePath}" -filter_complex "fps=${fps},scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" "${tempGif}"`);
    
    console.log(`[GifConversion] Uploading GIF to local storage`);
    
    const timestamp = Date.now();
    const gifStoragePath = join(streamerDir, `${timestamp}.gif`);
    const gifBuffer = await readFile(tempGif);
    await writeFile(gifStoragePath, gifBuffer);
    const gifUrl = `/api/media/${streamerName}/${timestamp}.gif`;

    await unlink(palettePath).catch(() => {});
    await unlink(tempGif).catch(() => {});
    await unlink(tempMp4).catch(() => {});

    console.log(`[GifConversion] Success: ${gifUrl}`);
    return gifUrl;

  } catch (error) {
    console.error(`[GifConversion] Error for ${streamerName}:`, error);
    
    if (browser) await browser.close().catch(() => {});
    await unlink(tempGif).catch(() => {});
    await unlink(tempMp4).catch(() => {});
    
    return null;
  }
}
