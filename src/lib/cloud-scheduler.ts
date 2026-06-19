'use server';

import { manualPoll } from './polling-service';

// Cloud-based polling using API calls instead of external worker processes.
export async function schedulePolling(serverId: string): Promise<void> {
  // On Fly.io this stores polling configuration in the mounted-volume database.
  
  const { db } = await import('@/data/server-init');
  
  await db.collection('servers').doc(serverId).set({
    pollingEnabled: true,
    lastPoll: new Date(),
    pollInterval: 5 * 60 * 1000, // 5 minutes
  }, { merge: true });
  
  console.log(`Scheduled polling for server ${serverId}`);
}

export async function stopPolling(serverId: string): Promise<void> {
  const { db } = await import('@/data/server-init');
  
  await db.collection('servers').doc(serverId).update({
    pollingEnabled: false,
  });
  
  console.log(`Stopped polling for server ${serverId}`);
}

export async function executeScheduledPoll(serverId: string): Promise<void> {
  const { db } = await import('@/data/server-init');
  
  // Check if polling is enabled
  const serverDoc = await db.collection('servers').doc(serverId).get();
  const serverData = serverDoc.data();
  
  if (!serverData?.pollingEnabled) {
    console.log(`Polling disabled for server ${serverId}`);
    return;
  }
  
  // Execute the poll
  await manualPoll(serverId);
  
  // Update last poll time
  await db.collection('servers').doc(serverId).update({
    lastPoll: new Date(),
  });
  
  console.log(`Completed scheduled poll for server ${serverId}`);
}
