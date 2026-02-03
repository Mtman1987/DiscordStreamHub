'use server';

import { db } from '@/firebase/server-init';
import { uploadGifFromUrl } from './firebase-storage-service';
import puppeteer from 'puppeteer';

interface CommunityStats {
  membersOnline: number;
  totalMembers: number;
  totalShoutouts: number;
  dailyShoutoutCount: number;
  leaderboardLeader: string;
  leaderPoints: number;
  lastUpdated: string;
}

export async function generateSpotlightHeaderImage(serverId: string, stats: CommunityStats): Promise<string | null> {
  // Check cooldown - don't regenerate within 9 minutes
  const cooldownRef = db.collection('servers').doc(serverId).collection('gifCooldowns').doc('header');
  const cooldownDoc = await cooldownRef.get();
  const cooldownMs = 9 * 60 * 1000; // 9 minutes
  
  if (cooldownDoc.exists) {
    const lastGenerated = cooldownDoc.data()?.lastGenerated?.toMillis();
    const cachedUrl = cooldownDoc.data()?.gifUrl;
    if (lastGenerated && cachedUrl && (Date.now() - lastGenerated) < cooldownMs) {
      console.log('[HeaderGen] Using cached header (cooldown active)');
      return cachedUrl;
    }
  }
  
  const timestamp = Date.now();
  const os = require('os');
  const tempVideoPath = `${os.tmpdir()}/header_${timestamp}.mp4`;
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 80 });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            font-family: 'Arial', sans-serif;
            color: white;
            overflow: hidden;
          }
          .header {
            padding: 5px;
            text-align: center;
            position: relative;
          }
          .marquee-header {
            white-space: nowrap;
            overflow: hidden;
            box-sizing: border-box;
          }
          .marquee-header-content {
            display: inline-block;
            padding-left: 100%;
            animation: marquee 40s linear infinite;
            font-size: 48px;
            font-weight: 900;
            text-shadow: 3px 3px 6px rgba(0,0,0,0.8);
            letter-spacing: 1px;
          }
          @keyframes marquee {
            0% { transform: translate3d(100%, 0, 0); }
            100% { transform: translate3d(-100%, 0, 0); }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="marquee-header">
            <div class="marquee-header-content">
              🏔️ ${stats.totalMembers} TOTAL MOUNTAINEERS 🏔️ • 🟢 ${stats.membersOnline} ONLINE NOW 🟢 • 📢 ${stats.totalShoutouts} ACTIVE SHOUTOUTS 📢 • 🎯 OVER ${stats.dailyShoutoutCount} SHOUTOUTS GIVEN TODAY 🎯 • 👑 LEADER: ${stats.leaderboardLeader.toUpperCase()} (${stats.leaderPoints} PTS) 👑 • 🚀 JOIN SPACE MOUNTAIN COMMUNITY 🚀 • ⏰ UPDATED ${stats.lastUpdated} ⏰ • 🎮 STREAMING SUPPORT NETWORK 🎮 • 💎 EARN POINTS FOR ACTIVITY 💎
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await page.setContent(html);
    
    // Force animation to start and wait for it to begin
    await page.evaluate(() => {
      const marquee = document.querySelector('.marquee-header-content');
      if (marquee) {
        marquee.style.animationPlayState = 'running';
        marquee.style.animation = 'marquee 40s linear infinite';
      }
    });
    
    console.log('[HeaderGen] Waiting 5 seconds for animation to start...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('[HeaderGen] Starting 45-second video recording for header...');
    
    try {
      const { PuppeteerScreenRecorder } = await import('puppeteer-screen-recorder');
      
      const recorder = new PuppeteerScreenRecorder(page, {
        fps: 15,
        ffmpeg_Path: 'ffmpeg',
        videoFrame: { width: 960, height: 80 },
        videoCrf: 23,
        videoCodec: 'libx264',
        videoPreset: 'fast',
        videoBitrate: 500,
      });
      
      await recorder.start(tempVideoPath);
      await new Promise(resolve => setTimeout(resolve, 45000));
      await recorder.stop();
      
      console.log('[HeaderGen] Converting header video to GIF...');
      const { convertClipToGif } = await import('./gif-conversion-service');
      const gifUrl = await convertClipToGif(
        tempVideoPath,
        `header_${timestamp}`,
        'header',
        45,
        'header',
        { serverId }
      );
      
      try { require('fs').unlinkSync(tempVideoPath); } catch (e) {}
      
      if (gifUrl) {
        console.log('[HeaderGen] Header GIF generated successfully');
        // Save to cooldown cache
        await cooldownRef.set({
          gifUrl,
          lastGenerated: new Date(),
          stats
        });
        return gifUrl;
      } else {
        console.log('[HeaderGen] GIF conversion failed, falling back to screenshot');
      }
      
    } catch (recorderError) {
      console.log('[HeaderGen] Screen recorder failed, using screenshot fallback');
    }
    
    // Fallback to screenshot
    const screenshot = await page.screenshot({ type: 'png' });
    const base64Image = `data:image/png;base64,${screenshot.toString('base64')}`;
    const fileName = `spotlight/header_${timestamp}.png`;
    const fallbackUrl = await uploadGifFromUrl(base64Image, fileName);
    
    if (fallbackUrl) {
      await cooldownRef.set({
        gifUrl: fallbackUrl,
        lastGenerated: new Date(),
        stats
      });
    }
    
    return fallbackUrl;
  } catch (error) {
    console.error('Error generating header image:', error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

export async function generateSpotlightFooterImage(serverId: string, stats: CommunityStats): Promise<string | null> {
  // Check cooldown - don't regenerate within 9 minutes
  const cooldownRef = db.collection('servers').doc(serverId).collection('gifCooldowns').doc('footer');
  const cooldownDoc = await cooldownRef.get();
  const cooldownMs = 9 * 60 * 1000; // 9 minutes
  
  if (cooldownDoc.exists) {
    const lastGenerated = cooldownDoc.data()?.lastGenerated?.toMillis();
    const cachedUrl = cooldownDoc.data()?.gifUrl;
    if (lastGenerated && cachedUrl && (Date.now() - lastGenerated) < cooldownMs) {
      console.log('[FooterGen] Using cached footer (cooldown active)');
      return cachedUrl;
    }
  }
  
  const timestamp = Date.now();
  const os = require('os');
  const tempVideoPath = `${os.tmpdir()}/footer_${timestamp}.mp4`;
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 120 });
    console.log('[FooterGen] Generating footer with stats:', stats);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
            font-family: 'Arial', sans-serif;
            color: white;
            overflow: hidden;
          }
          .footer {
            padding: 20px;
            text-align: center;
            position: relative;
          }
          .marquee-footer {
            white-space: nowrap;
            overflow: hidden;
            box-sizing: border-box;
          }
          .marquee-footer-content {
            display: inline-block;
            padding-left: 100%;
            animation: marquee 40s linear infinite;
            font-size: 48px;
            font-weight: 900;
            text-shadow: 3px 3px 6px rgba(0,0,0,0.8);
            letter-spacing: 1px;
          }
          @keyframes marquee {
            0% { transform: translate3d(100%, 0, 0); }
            100% { transform: translate3d(-100%, 0, 0); }
          }
          .timestamp {
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="footer">
          <div class="marquee-footer">
            <div class="marquee-footer-content">
              🌟 ${stats.totalMembers} MOUNTAINEERS STRONG 🌟 • 👑 LEADER: ${stats.leaderboardLeader.toUpperCase()} (${stats.leaderPoints} PTS) 👑 • 🚀 MADE BY MTMAN1987 🚀 • ⏰ UPDATED: ${stats.lastUpdated} ⏰ • 🏔️ SPACE MOUNTAIN COMMUNITY 🏔️ • 💪 GET FEATURED WHEN YOU GO LIVE 💪 • 🎆 STREAMING SUPPORT NETWORK 🎆
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await page.setContent(html);
    
    // Trigger animation start
    await page.evaluate(() => {
      const marquee = document.querySelector('.marquee-footer-content');
      if (marquee) {
        marquee.style.animationPlayState = 'running';
        marquee.style.animation = 'marquee 40s linear infinite';
      }
    });
    
    console.log('[FooterGen] Waiting 5 seconds before recording footer animation...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('[FooterGen] Starting 45-second video recording for footer...');
    
    try {
      const { PuppeteerScreenRecorder } = await import('puppeteer-screen-recorder');
      
      const recorder = new PuppeteerScreenRecorder(page, {
        fps: 15,
        ffmpeg_Path: 'ffmpeg',
        videoFrame: { width: 960, height: 120 },
        videoCrf: 23,
        videoCodec: 'libx264',
        videoPreset: 'fast',
        videoBitrate: 500,
      });
      
      await recorder.start(tempVideoPath);
      await new Promise(resolve => setTimeout(resolve, 45000));
      await recorder.stop();
      
      console.log('[FooterGen] Converting footer video to GIF...');
      const { convertClipToGif } = await import('./gif-conversion-service');
      const gifUrl = await convertClipToGif(
        tempVideoPath,
        `footer_${timestamp}`,
        'footer',
        45,
        'footer',
        { serverId }
      );
      
      try { require('fs').unlinkSync(tempVideoPath); } catch (e) {}
      
      if (gifUrl) {
        console.log('[FooterGen] Footer GIF generated successfully');
        // Save to cooldown cache
        await cooldownRef.set({
          gifUrl,
          lastGenerated: new Date(),
          stats
        });
        return gifUrl;
      } else {
        console.log('[FooterGen] GIF conversion failed, falling back to screenshot');
      }
      
    } catch (recorderError) {
      console.log('[FooterGen] Screen recorder failed, using screenshot fallback');
    }
    
    // Fallback to screenshot
    const screenshot = await page.screenshot({ type: 'png' });
    const base64Image = `data:image/png;base64,${screenshot.toString('base64')}`;
    const fileName = `spotlight/footer_${timestamp}.png`;
    const fallbackUrl = await uploadGifFromUrl(base64Image, fileName);
    
    if (fallbackUrl) {
      await cooldownRef.set({
        gifUrl: fallbackUrl,
        lastGenerated: new Date(),
        stats
      });
    }
    
    return fallbackUrl;
  } catch (error) {
    console.error('Error generating footer image:', error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function getDailyShoutoutCount(serverId: string): Promise<number> {
  try {
    const counterRef = db.collection('servers').doc(serverId).collection('analytics').doc('dailyShoutouts');
    const counterDoc = await counterRef.get();
    
    if (!counterDoc.exists) {
      // Initialize counter
      await counterRef.set({
        count: 0,
        startDate: new Date(),
        lastUpdated: new Date()
      });
      return 0;
    }
    
    const data = counterDoc.data();
    const startDate = data?.startDate?.toDate() || new Date();
    const now = new Date();
    
    // Check if it's been more than 24 hours
    const hoursDiff = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    
    if (hoursDiff >= 24) {
      // Archive old count and reset
      const archiveRef = db.collection('servers').doc(serverId).collection('analytics').doc(`dailyShoutouts_${startDate.toISOString().split('T')[0]}`);
      await archiveRef.set({
        date: startDate,
        totalShoutouts: data?.count || 0,
        archivedAt: now
      });
      
      // Reset counter
      await counterRef.set({
        count: 0,
        startDate: now,
        lastUpdated: now
      });
      
      return 0;
    }
    
    return data?.count || 0;
  } catch (error) {
    console.error('Error getting daily shoutout count:', error);
    return 0;
  }
}

export async function incrementDailyShoutoutCount(serverId: string, username?: string): Promise<void> {
  try {
    const counterRef = db.collection('servers').doc(serverId).collection('analytics').doc('dailyShoutouts');
    const counterDoc = await counterRef.get();
    

    
    if (!counterDoc.exists) {
      // Initialize with count 1
      await counterRef.set({
        count: 1,
        startDate: new Date(),
        lastUpdated: new Date()
      });
      return;
    }
    
    const data = counterDoc.data();
    const startDate = data?.startDate?.toDate() || new Date();
    const now = new Date();
    
    // Check if it's been more than 24 hours
    const hoursDiff = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    
    if (hoursDiff >= 24) {
      // Archive old count and start fresh
      const archiveRef = db.collection('servers').doc(serverId).collection('analytics').doc(`dailyShoutouts_${startDate.toISOString().split('T')[0]}`);
      await archiveRef.set({
        date: startDate,
        totalShoutouts: data?.count || 0,
        archivedAt: now
      });
      
      // Reset counter to 1
      await counterRef.set({
        count: 1,
        startDate: now,
        lastUpdated: now
      });
    } else {
      // Increment every Discord post (for API call tracking)
      await counterRef.update({
        count: (data?.count || 0) + 1,
        lastUpdated: now
      });
    }
  } catch (error) {
    console.error('Error incrementing daily shoutout count:', error);
  }
}

export async function getCommunityStats(serverId: string): Promise<CommunityStats> {
  try {
    const usersRef = db.collection('servers').doc(serverId).collection('users');
    
    // Get all users
    const allUsersSnapshot = await usersRef.get();
    const allUsers = allUsersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Count online members
    const membersOnline = allUsers.filter(user => user.isOnline).length;
    
    // Total members
    const totalMembers = allUsers.length;
    
    // Count active shoutouts (only for online users)
    const totalShoutouts = allUsers.filter(user => user.isOnline && user.dailyShoutout).length;
    
    // Get daily shoutout count
    const dailyShoutoutCount = await getDailyShoutoutCount(serverId);
    
    // Find leaderboard leader from leaderboard collection
    const leaderboardRef = db.collection('servers').doc(serverId).collection('leaderboard');
    const leaderboardSnapshot = await leaderboardRef.orderBy('points', 'desc').limit(1).get();
    
    let leaderboardLeader = 'MTMAN1987';
    let leaderPoints = 0;
    
    if (!leaderboardSnapshot.empty) {
      const topEntry = leaderboardSnapshot.docs[0].data();
      if (topEntry.userProfileId) {
        const userDoc = await usersRef.doc(topEntry.userProfileId).get();
        if (userDoc.exists) {
          leaderboardLeader = userDoc.data()?.username || 'MTMAN1987';
          leaderPoints = topEntry.points || 0;
        }
      } else if (topEntry.username) {
        // Fallback: try to find by username if userProfileId is missing
        const userQuery = await usersRef.where('username', '==', topEntry.username).limit(1).get();
        if (!userQuery.empty) {
          leaderboardLeader = topEntry.username;
          leaderPoints = topEntry.points || 0;
        }
      }
    }
    
    const now = new Date();
    const lastUpdated = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);

    return {
      membersOnline,
      totalMembers,
      totalShoutouts,
      dailyShoutoutCount,
      leaderboardLeader,
      leaderPoints,
      lastUpdated
    };
  } catch (error) {
    console.error('Error getting community stats:', error);
    return {
      membersOnline: 0,
      totalMembers: 0,
      totalShoutouts: 0,
      dailyShoutoutCount: 0,
      leaderboardLeader: 'Unknown',
      leaderPoints: 0,
      lastUpdated: 'Unknown'
    };
  }
}
