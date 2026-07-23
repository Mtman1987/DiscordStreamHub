'use server';

import { db } from '@/lib/db';
import { getClipsForUser } from './twitch-api-service';
import { readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { getAppUrl, getGifStorageChannelId, getStoragePath } from './runtime-config';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GIF_STORAGE_CHANNEL = getGifStorageChannelId();
const MAX_GIFS = 6;

export async function fetchNewGifOnLive(serverId: string, discordUserId: string, twitchLogin: string): Promise<void> {
  try {
    const gifDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
      .collection('gifRotation').doc('storage').get();

    const rawLastFetch = gifDoc.data()?.lastFetchedAt;
    const lastFetch = rawLastFetch instanceof Date ? rawLastFetch : rawLastFetch ? new Date(rawLastFetch) : null;
    const now = new Date();
    
    if (lastFetch && (now.getTime() - lastFetch.getTime()) < 24 * 60 * 60 * 1000) {
      return;
    }

    const clips = await getClipsForUser(twitchLogin, 1);
    if (!clips || clips.length === 0) {
      return;
    }

    const clip = clips[0];
    const gifBuffer = await fetchAndConvertClip(clip.id);
    if (!gifBuffer) {
      return;
    }

    const STORAGE_PATH = getStoragePath();
    const mediaPath = join(STORAGE_PATH, twitchLogin);

    const files = await readdir(mediaPath).catch(() => [] as string[]);
    const gifFiles = files.filter(f => f.endsWith('.gif')).sort();
    if (gifFiles.length >= MAX_GIFS) {
      const toDelete = gifFiles.slice(0, gifFiles.length - (MAX_GIFS - 1));
      for (const file of toDelete) {
        await unlink(join(mediaPath, file)).catch(() => {});
      }
    }

    const gifPath = join(mediaPath, `${Date.now()}.gif`);
    await writeFile(gifPath, gifBuffer);

    await gifDoc.ref.set({ lastFetchedAt: now, currentIndex: 0 }, { merge: true });
  } catch (error) {
    console.error(`[GifRotation] Error for ${twitchLogin}:`, error);
  }
}

async function fetchAndConvertClip(clipId: string): Promise<Buffer | null> {
  try {
    const response = await fetch(`https://clips.twitch.tv/${clipId}`);
    const html = await response.text();
    const match = html.match(/"sourceURL":"([^"]+)"/);
    if (!match) return null;

    const mp4Response = await fetch(match[1]);
    const mp4Buffer = Buffer.from(await mp4Response.arrayBuffer());
    
    const ffmpeg = require('fluent-ffmpeg');
    const { PassThrough } = require('stream');
    
    return new Promise((resolve) => {
      const buffers: Buffer[] = [];
      const outputStream = new PassThrough();
      
      outputStream.on('data', (chunk: Buffer) => buffers.push(chunk));
      outputStream.on('end', () => resolve(Buffer.concat(buffers)));
      outputStream.on('error', () => resolve(null));

      ffmpeg()
        .input(mp4Buffer)
        .inputFormat('mp4')
        .outputOptions(['-vf', 'fps=10,scale=480:-1:flags=lanczos', '-t', '30'])
        .format('gif')
        .pipe(outputStream);
    });
  } catch {
    return null;
  }
}

export async function getNextGifCdnUrl(serverId: string, discordUserId: string, twitchLogin: string): Promise<string | null> {
  try {
    const normalizedLogin = String(twitchLogin || '').trim().toLowerCase();
    if (!normalizedLogin) return null;

    const gifDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
      .collection('gifRotation').doc('storage').get();

    const STORAGE_PATH = getStoragePath();
    const mediaPath = join(STORAGE_PATH, normalizedLogin);
    
    const { existsSync } = await import('fs');
    const { mkdir } = await import('fs/promises');
    
    if (!existsSync(mediaPath)) {
      await mkdir(mediaPath, { recursive: true });
      return null;
    }
    
    const files = await readdir(mediaPath);
    const gifFiles = files.filter(f => f.endsWith('.gif')).sort();

    if (gifFiles.length === 0) {
      return null;
    }

    const currentIndex = gifDoc.data()?.currentIndex || 0;
    const nextIndex = (currentIndex + 1) % gifFiles.length;
    const gifFile = gifFiles[nextIndex];

    const gifUrl = `${getAppUrl().replace(/\/$/, '')}/api/media/${normalizedLogin}/${gifFile}`;
    
    await gifDoc.ref.set({ currentIndex: nextIndex }, { merge: true });
    return gifUrl;
  } catch (error) {
    console.error(`[GifRotation] Error getting GIF URL for ${twitchLogin}:`, error);
    return null;
  }
}
