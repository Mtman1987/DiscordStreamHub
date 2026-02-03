'use server';

import { db } from '@/firebase/server-init';
import { checkMultipleStreamsStatus } from './twitch-api-service';

export async function manualPoll(serverId: string): Promise<void> {
  console.log('[Polling] Manual poll triggered');
  await pollTwitchData(serverId);
}

async function pollTwitchData(serverId: string): Promise<void> {
  try {
    console.log(`[Polling] Starting poll for server ${serverId}`);

    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
    if (usersSnapshot.empty) {
      console.log('[Polling] No users found to poll.');
      return;
    }

    const usernames = usersSnapshot.docs.map(doc => doc.data().username?.toLowerCase()).filter(Boolean);
    if (usernames.length === 0) {
      console.log('[Polling] No valid usernames found to poll.');
      return;
    }

    const streamStatusMap = await checkMultipleStreamsStatus(usernames);
    console.log(`[Polling] Got status for ${streamStatusMap.size} users. ${Array.from(streamStatusMap.values()).filter(Boolean).length} are live.`);

    const batch = db.batch();
    let updatedCount = 0;

    usersSnapshot.docs.forEach(doc => {
      const userData = doc.data();
      const username = userData.username?.toLowerCase();
      if (!username) return;

      const isOnline = streamStatusMap.get(username) || false;
      if (userData.isOnline !== isOnline) {
        batch.update(doc.ref, { isOnline: isOnline, lastStatusUpdate: new Date() });
        updatedCount++;
        console.log(`[Polling] Status change for ${username}: ${userData.isOnline} -> ${isOnline}`);
      }
    });

    if (updatedCount > 0) {
      await batch.commit();
      console.log(`[Polling] Updated online status for ${updatedCount} users.`);
    } else {
      console.log('[Polling] No user status changes detected.');
    }

  } catch (error) {
    console.error('[Polling] Error during polling:', error);
  }
}
