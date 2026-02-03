'use server';

import { startTwitchPolling } from './twitch-polling-service';
import { db } from '@/firebase/server-init';

let initialized = false;

export async function initializeApp() {
  if (initialized) return;
  
  console.log('[AppInit] Starting application initialization...');
  
  try {
    const serverId = process.env.HARDCODED_GUILD_ID || process.env.GUILD_ID;
    
    if (!serverId) {
      console.warn('[AppInit] No server ID found in environment');
      return;
    }

    const serverDoc = await db.collection('servers').doc(serverId).get();
    const serverData = serverDoc.data();
    
    if (serverData?.twitchPollingActive) {
      console.log(`[AppInit] Starting Twitch polling for server ${serverId}`);
      await startTwitchPolling(serverId);
    }
    
    initialized = true;
    console.log('[AppInit] Application initialized successfully');
  } catch (error) {
    console.error('[AppInit] Error during initialization:', error);
  }
}

if (typeof window === 'undefined') {
  initializeApp().catch(console.error);
}
