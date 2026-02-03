'use server';

import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { storage } from '@/firebase/server-init';
import puppeteer from 'puppeteer';
import { getClipVideoUrl } from './clip-url-finder';

const execAsync = promisify(exec);

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
    
    // Step 1: Get MP4 URL
    const mp4Url = await getClipVideoUrl(clipUrl);
    if (!mp4Url) throw new Error('Failed to get video URL');
    console.log(`[GifConversion] Downloading MP4...`);
    
    // Step 2: Download MP4 to temp
    const mp4Response = await fetch(mp4Url);
    if (!mp4Response.ok) throw new Error(`Failed to download MP4: ${mp4Response.status}`);
    const mp4Buffer = Buffer.from(await mp4Response.arrayBuffer());
    await writeFile(tempMp4, mp4Buffer);
    console.log(`[GifConversion] Downloaded ${mp4Buffer.length} bytes`);
    
    // Step 3: Upload to Firebase Storage
    console.log(`[GifConversion] Uploading MP4 to Firebase...`);
    const mp4StoragePath = `clips/${streamerName}/${clipId}.mp4`;
    const bucket = storage.bucket();
    await bucket.upload(tempMp4, {
      destination: mp4StoragePath,
      metadata: { contentType: 'video/mp4' }
    });
    const mp4File = bucket.file(mp4StoragePath);
    await mp4File.makePublic();
    const cleanMp4Url = `https://storage.googleapis.com/${bucket.name}/${mp4StoragePath}`;
    console.log(`[GifConversion] Clean MP4 URL: ${cleanMp4Url}`);
    
    // Step 4: Convert MP4 directly to GIF with FFmpeg (no browser needed)
    console.log(`[GifConversion] Converting MP4 to GIF with FFmpeg...`);
    
    const palettePath = join(tmpdir(), `${clipId}_palette.png`);
    await execAsync(`ffmpeg -y -i "${tempMp4}" -vf "fps=${fps},scale=400:-1:flags=lanczos,palettegen" "${palettePath}"`);
    await execAsync(`ffmpeg -y -t ${maxDuration} -i "${tempMp4}" -i "${palettePath}" -filter_complex "fps=${fps},scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" "${tempGif}"`);
    
    console.log(`[GifConversion] Uploading GIF to Firebase Storage`);
    
    const gifStoragePath = `clips/${streamerName}/${Date.now()}.gif`;
    await bucket.upload(tempGif, {
      destination: gifStoragePath,
      metadata: {
        contentType: 'image/gif',
        metadata: { clipId, streamerName, createdAt: new Date().toISOString() }
      }
    });

    const gifFile = bucket.file(gifStoragePath);
    await gifFile.makePublic();
    const gifUrl = `https://storage.googleapis.com/${bucket.name}/${gifStoragePath}`;

    // Cleanup
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
    
    return 'https://media.tenor.com/yG_mD8bW32EAAAAd/star-wars-celebration-lightsaber.gif';
  }
}
