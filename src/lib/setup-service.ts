'use server';

import { db } from '@/firebase/server-init';

export async function initializeServerConfig(serverId: string, config: {
  crewChannelId?: string;
  partnersChannelId?: string;
  communityChannelId?: string;
  raidPileChannelId?: string;
}) {
  try {
    await db.collection('servers').doc(serverId).set({
      ...config,
      twitchPollingActive: false, // Start disabled
      lastUpdated: new Date(),
      createdAt: new Date()
    }, { merge: true });

    console.log(`[Setup] Server ${serverId} configured successfully`);
    return { success: true };
  } catch (error) {
    console.error('[Setup] Error:', error);
    return { success: false, error };
  }
}

export async function enablePolling(serverId: string) {
  try {
    await db.collection('servers').doc(serverId).update({
      twitchPollingActive: true,
      pollingEnabledAt: new Date()
    });

    console.log(`[Setup] Polling enabled for ${serverId}`);
    return { success: true };
  } catch (error) {
    console.error('[Setup] Error:', error);
    return { success: false, error };
  }
}

export async function setUserGroup(serverId: string, userId: string, group: string, twitchLogin?: string) {
  try {
    const data: any = {
      group,
      lastUpdated: new Date()
    };
    
    if (twitchLogin) {
      data.twitchLogin = twitchLogin;
    }

    await db.collection('servers').doc(serverId)
      .collection('users').doc(userId)
      .set(data, { merge: true });

    console.log(`[Setup] User ${userId} set to group ${group}`);
    return { success: true };
  } catch (error) {
    console.error('[Setup] Error:', error);
    return { success: false, error };
  }
}
