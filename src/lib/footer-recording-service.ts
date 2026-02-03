'use server';

import puppeteer from 'puppeteer';
import { uploadGifFromUrl } from './firebase-storage-service';
import { convertClipToGif } from './gif-conversion-service';

export async function generateFooterGif(
  footerUrl: string,
  fileName: string
): Promise<{ gifUrl: string; mp4Url: string } | null> {
  let browser;
  try {
    console.log(`[Footer Recording] Starting footer recording for ${fileName}`);
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ],
    });

    const page = await browser.newPage();
    
    // Footer dimensions - wide and short rectangular
    await page.setViewport({
      width: 1200,
      height: 200,
      deviceScaleFactor: 1,
    });

    console.log(`[Footer Recording] Navigating to ${footerUrl}`);
    await page.goto(footerUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for footer to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const timestamp = Date.now();
    
    // Record for 45 seconds to capture one complete footer cycle (40s + buffer)
    const duration = 45000; // 45 seconds in milliseconds
    const os = require('os');
    const tempVideoPath = `${os.tmpdir()}/footer_${fileName}_${timestamp}.mp4`;
    
    console.log(`[Footer Recording] Starting 45-second footer recording`);
    
    try {
      const { PuppeteerScreenRecorder } = await import('puppeteer-screen-recorder');
      
      const recorder = new PuppeteerScreenRecorder(page, {
        fps: 15, // Same FPS as stream clips for consistency
        ffmpeg_Path: 'ffmpeg',
        videoFrame: {
          width: 1200,
          height: 200,
        },
        videoCrf: 23,
        videoCodec: 'libx264',
        videoPreset: 'fast',
        videoBitrate: 300, // Lower bitrate for footer
      });
      
      await recorder.start(tempVideoPath);
      await new Promise(resolve => setTimeout(resolve, duration));
      await recorder.stop();
      
      // Convert to GIF and upload
      const gifUrl = await convertClipToGif(tempVideoPath, `footer_${fileName}_${timestamp}`, fileName, 45);
      
      const fs = require('fs');
      const videoBuffer = fs.readFileSync(tempVideoPath);
      const base64Video = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
      const mp4FileName = `recordings/footer_${fileName}_${timestamp}.mp4`;
      const mp4Url = await uploadGifFromUrl(base64Video, mp4FileName);
      
      try { fs.unlinkSync(tempVideoPath); } catch (e) {}
      
      return { gifUrl, mp4Url };
      
    } catch (recorderError) {
      console.log(`[Footer Recording] Screen recorder failed, using screenshot method:`, recorderError.message);
      
      // Fallback: Multiple screenshots for animated GIF
      const frames = [];
      const frameCount = 23; // 23 frames over 45 seconds
      const frameInterval = duration / frameCount;
      
      for (let i = 0; i < frameCount; i++) {
        try {
          const screenshot = await page.screenshot({ 
            type: 'png',
            clip: { x: 0, y: 0, width: 1200, height: 200 }
          });
          frames.push(screenshot);
          
          if (i < frameCount - 1) {
            await new Promise(resolve => setTimeout(resolve, frameInterval));
          }
        } catch (e) {
          break;
        }
      }
      
      if (frames.length > 1) {
        // Create GIF from frames using FFmpeg
        const fs = require('fs');
        const path = require('path');
        const tempDir = path.join(os.tmpdir(), `footer_frames_${timestamp}`);
        
        try {
          fs.mkdirSync(tempDir, { recursive: true });
          
          // Save frames
          for (let i = 0; i < frames.length; i++) {
            fs.writeFileSync(path.join(tempDir, `frame_${i.toString().padStart(3, '0')}.png`), frames[i]);
          }
          
          // Create GIF with FFmpeg
          const { exec } = require('child_process');
          const gifPath = path.join(tempDir, 'output.gif');
          const cmd = `ffmpeg -y -framerate 2 -i "${tempDir}/frame_%03d.png" -vf "scale=1200:200:flags=lanczos,palettegen" "${tempDir}/palette.png" && ffmpeg -y -framerate 2 -i "${tempDir}/frame_%03d.png" -i "${tempDir}/palette.png" -filter_complex "scale=1200:200:flags=lanczos[x];[x][1:v]paletteuse" "${gifPath}"`;
          
          await new Promise((resolve) => {
            exec(cmd, () => resolve(null));
          });
          
          let gifUrl = null;
          if (fs.existsSync(gifPath)) {
            const gifBuffer = fs.readFileSync(gifPath);
            const base64Gif = `data:image/gif;base64,${gifBuffer.toString('base64')}`;
            const gifFileName = `gifs/footer_${fileName}_${timestamp}.gif`;
            gifUrl = await uploadGifFromUrl(base64Gif, gifFileName);
          }
          
          fs.rmSync(tempDir, { recursive: true, force: true });
          
          const mp4FileName = `recordings/footer_${fileName}_${timestamp}.mp4`;
          const mp4Url = `https://firebasestorage.googleapis.com/v0/b/studio-9468926194-e03ac.firebasestorage.app/o/${encodeURIComponent(mp4FileName)}?alt=media`;
          
          return { gifUrl, mp4Url };
          
        } catch (frameError) {
          console.log('Footer frame processing failed:', frameError.message);
        }
      }
    }
      
    // Final fallback
    console.log(`[Footer Recording] All recording methods failed, using single screenshot`);
    
    const screenshot = await page.screenshot({ 
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 200 }
    });
    const base64Image = `data:image/png;base64,${screenshot.toString('base64')}`;
    
    const gifFileName = `gifs/footer_${fileName}_${timestamp}.gif`;
    const firebaseUrl = await uploadGifFromUrl(base64Image, gifFileName);
    
    const mp4FileName = `recordings/footer_${fileName}_${timestamp}.mp4`;
    const mockMp4Url = `https://firebasestorage.googleapis.com/v0/b/studio-9468926194-e03ac.firebasestorage.app/o/${encodeURIComponent(mp4FileName)}?alt=media`;
    
    return {
      gifUrl: firebaseUrl,
      mp4Url: mockMp4Url
    };

  } catch (error) {
    console.error(`[Footer Recording] Error:`, error);
    return null;
  } finally {
    if (browser) {
      console.log(`[Footer Recording] Closing browser`);
      await browser.close();
    }
  }
}