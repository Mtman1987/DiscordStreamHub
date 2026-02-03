'use server';

import puppeteer from 'puppeteer';
import { uploadGifFromUrl } from './firebase-storage-service';
import { sendDiscordMessage } from './discord-bot-service';

export async function generateAndPostLeaderboard(serverId: string): Promise<void> {
  try {
    console.log('[Leaderboard] Generating leaderboard screenshot...');
    
    const appUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
    const leaderboardUrl = `${appUrl}/headless/leaderboard/${serverId}`;
    
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      
      console.log(`[Leaderboard] Navigating to ${leaderboardUrl}`);
      await page.goto(leaderboardUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000
      });
      
      // Wait for leaderboard to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const screenshot = await page.screenshot({ 
        type: 'png',
        fullPage: true
      });
      
      const base64Image = `data:image/png;base64,${screenshot.toString('base64')}`;
      const fileName = `leaderboard/leaderboard_${Date.now()}.png`;
      const imageUrl = await uploadGifFromUrl(base64Image, fileName);
      
      if (imageUrl) {
        console.log('[Leaderboard] Screenshot generated successfully');
        
        // Get leaderboard channel from server config or env
        const { db } = await import('@/firebase/server-init');
        const serverDoc = await db.collection('servers').doc(serverId).get();
        const serverData = serverDoc.data();
        
        const channelId = serverData?.leaderboardChannelId || 
                         serverData?.config?.channels?.leaderboard || 
                         process.env.DISCORD_LEADERBOARD_CHANNEL_ID;
        
        console.log('[Leaderboard] Using channel ID:', channelId);
        if (channelId) {
          const message = {
            content: `🚀 **SPACE MOUNTAIN LEADERBOARD** 🚀\n\n⭐ Current top performers in our space fleet! ⭐\n\nUpdated: ${new Date().toLocaleString()}`,
            embeds: [{
              image: { url: imageUrl },
              color: 0x7289DA,
              footer: { text: "Space Mountain Community • Leaderboard" }
            }],
            components: [{
              type: 1,
              components: [{
                type: 2,
                style: 5,
                label: "🔍 Check Your Rank",
                url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/rank/${serverId}`
              }]
            }]
          };
          
          await sendDiscordMessage(channelId, message);
          console.log('[Leaderboard] Posted to Discord successfully');
        } else {
          console.log('[Leaderboard] No Discord leaderboard channel configured');
        }
      }
      
    } finally {
      if (browser) await browser.close();
    }
    
  } catch (error) {
    console.error('[Leaderboard] Error generating/posting leaderboard:', error);
  }
}