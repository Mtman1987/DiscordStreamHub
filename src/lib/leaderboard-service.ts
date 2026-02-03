'use server';

import puppeteer from 'puppeteer';
import { uploadGifFromUrl } from './firebase-storage-service';
import { convertClipToGif } from './gif-conversion-service';
import { PointsService } from './points-service';
import { db } from '@/firebase/server-init';

export async function getUserRank(serverId: string, username: string): Promise<{ points: number; rank: number } | null> {
  try {
    const pointsService = PointsService.getInstance();
    const leaderboard = await pointsService.getLeaderboard(100);
    
    const userEntry = leaderboard.find(entry => 
      entry.lastEventMetadata?.username === username || 
      entry.userProfileId === username
    );
    
    if (!userEntry) return null;
    
    const rank = leaderboard.findIndex(entry => entry.userProfileId === userEntry.userProfileId) + 1;
    return { points: userEntry.points || 0, rank };
  } catch (error) {
    console.error('Error getting user rank:', error);
    return null;
  }
}

export async function generateLeaderboardGifFromPage(serverId: string): Promise<string | null> {
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  const leaderboardUrl = `${appUrl}/headless/leaderboard/${serverId}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    await page.goto(leaderboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.leaderboard', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const timestamp = Date.now();
    const duration = 30000;
    const os = require('os');
    const tempVideoPath = `${os.tmpdir()}/leaderboard_${timestamp}.mp4`;

    try {
      const { PuppeteerScreenRecorder } = await import('puppeteer-screen-recorder');
      const recorder = new PuppeteerScreenRecorder(page, {
        fps: 15,
        videoFrame: { width: 800, height: 600 },
        videoCrf: 23
      });
      
      await recorder.start(tempVideoPath);
      await new Promise(resolve => setTimeout(resolve, duration));
      await recorder.stop();
      
      const gifUrl = await convertClipToGif(
        tempVideoPath,
        `leaderboard_${timestamp}`,
        'leaderboard',
        30,
        'stream',
        { serverId }
      );
      const fs = require('fs');
      try { fs.unlinkSync(tempVideoPath); } catch (e) {}
      return gifUrl;
    } catch (error) {
      const screenshot = await page.screenshot({ type: 'png' });
      const base64Image = `data:image/png;base64,${screenshot.toString('base64')}`;
      return await uploadGifFromUrl(base64Image, `leaderboards/leaderboard_${timestamp}.gif`);
    }
  } catch (error) {
    console.error('Error generating leaderboard GIF:', error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

export async function generateLeaderboardGif(serverId: string): Promise<string | null> {
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  const leaderboardUrl = `${appUrl}/headless/leaderboard/${serverId}`;

  let browser;
  try {
    console.log(`[Puppeteer] Launching browser for leaderboard GIF`);
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    console.log(`[Puppeteer] Navigating to ${leaderboardUrl}`);
    await page.goto(leaderboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForSelector('.leaderboard', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const timestamp = Date.now();
    const duration = 30000; // 30 seconds
    const os = require('os');
    const tempVideoPath = `${os.tmpdir()}/leaderboard_${timestamp}.mp4`;

    console.log(`[Puppeteer] Starting 30-second leaderboard recording`);

    try {
      const { PuppeteerScreenRecorder } = await import('puppeteer-screen-recorder');
      
      const recorder = new PuppeteerScreenRecorder(page, {
        fps: 15,
        ffmpeg_Path: 'ffmpeg',
        videoFrame: { width: 800, height: 600 },
        videoCrf: 23,
        videoCodec: 'libx264',
        videoPreset: 'fast',
        videoBitrate: 500
      });
      
      await recorder.start(tempVideoPath);
      await new Promise(resolve => setTimeout(resolve, duration));
      await recorder.stop();
      
      const gifUrl = await convertClipToGif(
        tempVideoPath,
        `leaderboard_${timestamp}`,
        'leaderboard',
        30,
        'stream',
        { serverId }
      );
      
      const fs = require('fs');
      try { fs.unlinkSync(tempVideoPath); } catch (e) {}
      
      return gifUrl;
      
    } catch (recorderError) {
      console.log(`[Puppeteer] Screen recorder failed, using screenshot method`);
      
      const frames = [];
      const frameCount = 30;
      const frameInterval = duration / frameCount;
      
      for (let i = 0; i < frameCount; i++) {
        const screenshot = await page.screenshot({ 
          type: 'png',
          clip: { x: 0, y: 0, width: 800, height: 600 }
        });
        frames.push(screenshot);
        
        if (i < frameCount - 1) {
          await new Promise(resolve => setTimeout(resolve, frameInterval));
        }
      }
      
      if (frames.length > 1) {
        const fs = require('fs');
        const path = require('path');
        const tempDir = path.join(os.tmpdir(), `leaderboard_frames_${timestamp}`);
        
        try {
          fs.mkdirSync(tempDir, { recursive: true });
          
          for (let i = 0; i < frames.length; i++) {
            fs.writeFileSync(path.join(tempDir, `frame_${i.toString().padStart(3, '0')}.png`), frames[i]);
          }
          
          const { exec } = require('child_process');
          const gifPath = path.join(tempDir, 'output.gif');
          const cmd = `ffmpeg -y -framerate 2 -i "${tempDir}/frame_%03d.png" -vf "scale=800:600:flags=lanczos,palettegen" "${tempDir}/palette.png" && ffmpeg -y -framerate 2 -i "${tempDir}/frame_%03d.png" -i "${tempDir}/palette.png" -filter_complex "scale=800:600:flags=lanczos[x];[x][1:v]paletteuse" "${gifPath}"`;
          
          await new Promise((resolve) => {
            exec(cmd, () => resolve(null));
          });
          
          if (fs.existsSync(gifPath)) {
            const gifBuffer = fs.readFileSync(gifPath);
            const base64Gif = `data:image/gif;base64,${gifBuffer.toString('base64')}`;
            const gifFileName = `leaderboards/leaderboard_${timestamp}.gif`;
            const gifUrl = await uploadGifFromUrl(base64Gif, gifFileName);
            
            fs.rmSync(tempDir, { recursive: true, force: true });
            return gifUrl;
          }
          
        } catch (frameError) {
          console.log('Frame processing failed:', frameError.message);
        }
      }
    }
    
    // Fallback: single screenshot
    const screenshot = await page.screenshot({ 
      type: 'png',
      clip: { x: 0, y: 0, width: 800, height: 600 }
    });
    const base64Image = `data:image/png;base64,${screenshot.toString('base64')}`;
    const gifFileName = `leaderboards/leaderboard_${timestamp}.gif`;
    return await uploadGifFromUrl(base64Image, gifFileName);

  } catch (error) {
    console.error(`[generateLeaderboardGif] Error:`, error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
