'use server';

import { db } from '@/lib/db';
import { getUserByLogin, getClipsForUser } from './twitch-api-service';
import { convertClipToGif } from './gif-conversion-service';
import { deleteGif } from './local-storage-service';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getAppUrl, getPuppeteerExecutablePath, getStoragePath } from './runtime-config';

const STORAGE_PATH = getStoragePath();

// In-memory cooldown guard — survives within process lifetime
// The app database is the source of truth; this prevents races within a poll cycle.
const clipCooldowns = new Map<string, number>();
const COOLDOWN_MS = 12 * 60 * 60 * 1000;

interface CachedClip {
  clipId: string;
  gifUrl: string;
  twitchLogin: string;
  title: string;
  createdAt: string;
  cachedAt: string;
}

export async function bulkFetchClips(serverId: string): Promise<void> {
  console.log('[ClipFetching] Starting bulk clip fetch (10 per person)');
  
  const crewAndPartners = await getCrewAndPartners(serverId);
  console.log(`[ClipFetching] Found ${crewAndPartners.length} Crew/Partners members`);
  
  for (let i = 0; i < crewAndPartners.length; i++) {
    const user = crewAndPartners[i];
    try {
      console.log(`[ClipFetching] Processing ${i + 1}/${crewAndPartners.length}: ${user.twitchLogin}`);
      
      const twitchUser = await getUserByLogin(user.twitchLogin);
      if (!twitchUser) {
        console.log(`[ClipFetching] Twitch user not found: ${user.twitchLogin}`);
        continue;
      }

      const clips = await getClipsForUser(twitchUser.id, 50);
      console.log(`[ClipFetching] Found ${clips.length} clips for ${user.twitchLogin}`);
      
      let successCount = 0;
      for (const clip of clips) {
        if (successCount >= 6) break;
        
        const gifUrl = await convertClipToGif(
          clip.url,
          clip.id,
          user.twitchLogin,
          Math.min(clip.duration, 60),
          'stream',
          { serverId }
        );

        if (gifUrl && !gifUrl.includes('tenor.com')) {
          successCount++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`[ClipFetching] Completed ${user.twitchLogin}`);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`[ClipFetching] Error for ${user.twitchLogin}:`, error);
    }
  }
  
  console.log('[ClipFetching] Bulk fetch complete!');
}

export async function fetchNewClipOnLive(serverId: string, userId: string, twitchLogin: string): Promise<void> {
  try {
    const now = Date.now();
    const cacheKey = `${serverId}_${userId}`;
    
    // In-memory guard first (prevents race conditions within same process)
    const memCooldown = clipCooldowns.get(cacheKey);
    if (memCooldown && now - memCooldown < COOLDOWN_MS) {
      console.log(`[ClipFetching] ${twitchLogin} cooldown (memory): ${Math.round((COOLDOWN_MS - (now - memCooldown)) / 60000)}min remaining`);
      return;
    }
    
    // Database check (persists across restarts)
    const lastFetch = await getLastClipFetch(serverId, userId);
    if (lastFetch && now - lastFetch < COOLDOWN_MS) {
      clipCooldowns.set(cacheKey, lastFetch);
      console.log(`[ClipFetching] ${twitchLogin} cooldown (database): ${Math.round((COOLDOWN_MS - (now - lastFetch)) / 60000)}min remaining`);
      return;
    }
    
    // Don't set cooldown yet - only set after success

    const twitchUser = await getUserByLogin(twitchLogin);
    if (!twitchUser) return;

    console.log(`[ClipFetching] Fetching 100 clips for ${twitchLogin}...`);
    let clips = await getClipsForUser(twitchUser.id, 100);
    if (clips.length === 0) {
      console.log(`[ClipFetching] No clips found for ${twitchLogin}, auto-creating clip...`);
      const { createClip } = await import('./twitch-api-service');
      const newClipId = await createClip(twitchUser.id, serverId);
      if (newClipId) {
        await new Promise(resolve => setTimeout(resolve, 15000));
        clips = await getClipsForUser(twitchUser.id, 10);
        if (clips.length > 0) {
          console.log(`[ClipFetching] Auto-created clip ready for ${twitchLogin}`);
        }
      }
      // If still no clips, record the live stream directly
      if (clips.length === 0) {
        console.log(`[ClipFetching] No clips available, recording live stream for ${twitchLogin}...`);
        const recorded = await recordLiveStream(twitchLogin);
        if (recorded > 0) {
          console.log(`[ClipFetching] Recorded ${recorded} GIFs from live stream for ${twitchLogin}`);
          clipCooldowns.set(cacheKey, now);
          await setLastClipFetch(serverId, userId, now);
        } else {
          console.log(`[ClipFetching] Live stream recording failed for ${twitchLogin}`);
        }
        return;
      }
    }

    console.log(`[ClipFetching] Found ${clips.length} clips, trying newest 5 first...`);
    let successCount = 0;
    const targetGifs = 2;
    
    // Try 5 newest first
    const newestClips = clips.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);
    for (const clip of newestClips) {
      if (successCount >= targetGifs) break;
      
      try {
        const gifPath = await convertClipToGif(
          clip.url,
          clip.id,
          twitchLogin,
          Math.min(clip.duration, 30),
          'stream',
          { serverId }
        );

        if (gifPath && !gifPath.includes('tenor.com')) {
          successCount++;
          console.log(`[ClipFetching] Success ${successCount}/${targetGifs} for ${twitchLogin}`);
        }
      } catch (clipError) {
        console.log(`[ClipFetching] Clip ${clip.id} failed, trying next...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // If didn't get 2, try 5 most popular
    if (successCount < targetGifs) {
      console.log(`[ClipFetching] Only got ${successCount}, trying 5 most popular...`);
      const popularClips = clips.sort((a, b) => b.view_count - a.view_count).slice(0, 5);
      
      for (const clip of popularClips) {
        if (successCount >= targetGifs) break;
        
        try {
          const gifPath = await convertClipToGif(
            clip.url,
            clip.id,
            twitchLogin,
            Math.min(clip.duration, 30),
            'stream',
            { serverId }
          );

          if (gifPath && !gifPath.includes('tenor.com')) {
            successCount++;
            console.log(`[ClipFetching] Success ${successCount}/${targetGifs} for ${twitchLogin}`);
          }
        } catch (clipError) {
          console.log(`[ClipFetching] Clip ${clip.id} failed, trying next...`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    // Only set cooldown after success
    if (successCount > 0) {
      clipCooldowns.set(cacheKey, now);
      await setLastClipFetch(serverId, userId, now);
      console.log(`[ClipFetching] Completed ${twitchLogin}: ${successCount} GIFs created`);
    } else {
      console.log(`[ClipFetching] No GIFs from clips, recording live stream for ${twitchLogin}...`);
      const recorded = await recordLiveStream(twitchLogin);
      if (recorded > 0) {
        clipCooldowns.set(cacheKey, now);
        await setLastClipFetch(serverId, userId, now);
        console.log(`[ClipFetching] Completed ${twitchLogin}: ${recorded} GIFs from live recording`);
      } else {
        console.log(`[ClipFetching] Failed to create any GIFs for ${twitchLogin}`);
      }
    }
  } catch (error) {
    console.error(`[ClipFetching] Error for ${twitchLogin}:`, error);
  }
}

async function recordLiveStream(twitchLogin: string): Promise<number> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const { writeFile, mkdir, readdir: readdirAsync, unlink, readFile: readFileAsync, rmdir } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const { join: joinPath } = await import('path');
  const { existsSync: existsSyncLocal } = await import('fs');
  const execAsync = promisify(exec);
  const puppeteer = await import('puppeteer');

  const streamerDir = joinPath(STORAGE_PATH, twitchLogin);
  if (!existsSyncLocal(streamerDir)) await mkdir(streamerDir, { recursive: true });

  let browser;
  try {
    console.log(`[LiveRecord] Launching browser for ${twitchLogin}...`);
    browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
      executablePath: getPuppeteerExecutablePath() || undefined,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const twitchParent = new URL(getAppUrl() || 'http://localhost:3000').hostname;
    const embedUrl = `https://player.twitch.tv/?channel=${twitchLogin}&parent=${encodeURIComponent(twitchParent)}&muted=true`;
    console.log(`[LiveRecord] Navigating to ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for player to appear
    await page.waitForSelector('video', { timeout: 15000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Click through content classification / mature content gate / play button
    // Try multiple times since overlays can stack
    for (let attempt = 0; attempt < 3; attempt++) {
      const clicked = await page.evaluate(() => {
        // Mature content warning "Start Watching" button
        const startBtn = document.querySelector('button[data-a-target="content-classification-gate-overlay-start-watching-button"]') as HTMLElement;
        if (startBtn) { startBtn.click(); return 'mature-gate'; }
        // Generic overlay click handler (dismisses overlays)
        const overlay = document.querySelector('[data-a-target="player-overlay-click-handler"]') as HTMLElement;
        if (overlay) { overlay.click(); return 'overlay'; }
        // Play/pause button
        const playBtn = document.querySelector('[data-a-target="player-play-pause-button"]') as HTMLElement;
        if (playBtn) { playBtn.click(); return 'play-btn'; }
        return null;
      });
      if (clicked) console.log(`[LiveRecord] Clicked: ${clicked} (attempt ${attempt + 1})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Final click on video element itself to ensure playback
    await page.click('video').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify video is actually playing
    const isPlaying = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && !video.paused && video.readyState >= 2;
    });
    if (!isPlaying) {
      console.log(`[LiveRecord] Video not playing, trying one more click...`);
      await page.click('video').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const finalCheck = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return { paused: video?.paused, readyState: video?.readyState, currentTime: video?.currentTime };
    });
    console.log(`[LiveRecord] Video state: paused=${finalCheck.paused}, readyState=${finalCheck.readyState}, currentTime=${finalCheck.currentTime}`);

    if (finalCheck.paused || (finalCheck.readyState || 0) < 2) {
      console.log(`[LiveRecord] Video still not playing for ${twitchLogin}, aborting`);
      return 0;
    }

    let successCount = 0;

    for (let i = 0; i < 2; i++) {
      const tempGif = joinPath(tmpdir(), `live_${twitchLogin}_${i}_${Date.now()}.gif`);
      const frameDir = joinPath(tmpdir(), `frames_${twitchLogin}_${i}_${Date.now()}`);
      const palettePath = joinPath(tmpdir(), `palette_${twitchLogin}_${i}_${Date.now()}.png`);

      try {
        console.log(`[LiveRecord] Recording 30s clip ${i + 1}/2 for ${twitchLogin}...`);
        await mkdir(frameDir, { recursive: true });

        const fps = 10;
        const totalFrames = fps * 30;
        const interval = 1000 / fps;

        for (let f = 0; f < totalFrames; f++) {
          const frame = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 720 } });
          await writeFile(joinPath(frameDir, `frame_${String(f).padStart(5, '0')}.png`), frame as Buffer);
          await new Promise(resolve => setTimeout(resolve, interval));
        }

        console.log(`[LiveRecord] Captured ${totalFrames} frames, assembling GIF...`);
        await execAsync(`ffmpeg -y -framerate ${fps} -i "${joinPath(frameDir, 'frame_%05d.png')}" -vf "fps=${fps},scale=480:-1:flags=lanczos,palettegen" "${palettePath}"`);
        await execAsync(`ffmpeg -y -framerate ${fps} -i "${joinPath(frameDir, 'frame_%05d.png')}" -i "${palettePath}" -filter_complex "fps=${fps},scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 "${tempGif}"`);

        // Enforce 10 GIF limit
        const existing = (await readdirAsync(streamerDir)).filter(f => f.endsWith('.gif')).sort();
        if (existing.length >= 5) {
          for (const old of existing.slice(0, existing.length - 4)) {
            await unlink(joinPath(streamerDir, old)).catch(() => {});
          }
        }

        const gifBuffer = await readFileAsync(tempGif);
        await writeFile(joinPath(streamerDir, `${Date.now()}.gif`), gifBuffer);
        successCount++;
        console.log(`[LiveRecord] GIF ${successCount}/2 saved for ${twitchLogin}`);
      } catch (clipErr) {
        console.error(`[LiveRecord] Clip ${i + 1} failed:`, clipErr);
      } finally {
        await unlink(palettePath).catch(() => {});
        await unlink(tempGif).catch(() => {});
        const frameFiles = await readdirAsync(frameDir).catch(() => [] as string[]);
        for (const f of frameFiles) await unlink(joinPath(frameDir, f)).catch(() => {});
        await rmdir(frameDir).catch(() => {});
      }

      // Gap between recordings for different content
      if (i === 0 && successCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    return successCount;
  } catch (error) {
    console.error(`[LiveRecord] Error for ${twitchLogin}:`, error);
    return 0;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function getLastClipFetch(serverId: string, userId: string): Promise<number | null> {
  const doc = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId).get();
  return doc.data()?.lastClipFetch || null;
}

async function setLastClipFetch(serverId: string, userId: string, timestamp: number): Promise<void> {
  await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .update({ lastClipFetch: timestamp });
}

export async function getCurrentClipForUser(serverId: string, userId: string): Promise<CachedClip | null> {
  const { getCurrentGifForUser } = await import('./discord-gif-storage');
  const gif = await getCurrentGifForUser(serverId, userId);
  
  if (!gif) return null;

  const userDoc = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId).get();
  const twitchLogin = userDoc.data()?.twitchLogin || 'unknown';

  return {
    clipId: gif.clipId,
    gifUrl: gif.discordUrl,
    twitchLogin,
    title: 'Clip',
    createdAt: gif.uploadedAt,
    cachedAt: gif.uploadedAt
  };
}

export async function getCurrentVipClip(serverId: string): Promise<CachedClip | null> {
  const crewAndPartners = await getCrewAndPartners(serverId);
  if (crewAndPartners.length === 0) return null;
  
  const randomUser = crewAndPartners[Math.floor(Math.random() * crewAndPartners.length)];
  return getCurrentClipForUser(serverId, randomUser.discordUserId);
}

async function getCrewAndPartners(serverId: string) {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users')
    .get();

  return snapshot.docs
    .map((doc: { id: string; data: () => any }) => ({
      discordUserId: doc.id,
      twitchLogin: doc.data().twitchLogin,
      group: doc.data().group
    }))
    .filter((u: { twitchLogin?: string; group?: string }) => u.twitchLogin && (u.group === 'Crew' || u.group === 'Partners'));
}
