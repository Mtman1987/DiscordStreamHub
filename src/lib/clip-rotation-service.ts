'use server';

import { db } from '@/firebase/server-init';
import { getUserByLogin, getClipsForUser } from './twitch-api-service';
import { convertClipToGif } from './gif-conversion-service';
import { deleteGif } from './firebase-storage-service';
import { getClipVideoUrl } from './clip-url-finder';

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
        if (successCount >= 10) break;
        
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
      
      console.log(`[ClipFetching] ✅ Completed ${user.twitchLogin}`);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`[ClipFetching] ❌ Error for ${user.twitchLogin}:`, error);
    }
  }
  
  console.log('[ClipFetching] 🎉 Bulk fetch complete!');
}

export async function fetchNewClipOnLive(serverId: string, userId: string, twitchLogin: string): Promise<void> {
  try {
    // Check if already fetched today
    const lastFetch = await getLastClipFetch(serverId, userId);
    const now = Date.now();
    
    if (lastFetch && now - lastFetch < 24 * 60 * 60 * 1000) {
      console.log(`[ClipFetching] ${twitchLogin} already fetched today`);
      return;
    }

    const twitchUser = await getUserByLogin(twitchLogin);
    if (!twitchUser) return;

    const clips = await getClipsForUser(twitchUser.id, 20);
    if (clips.length === 0) return;

    // Get existing GIFs from Storage
    const { storage } = await import('@/firebase/server-init');
    const bucket = storage.bucket();
    const [files] = await bucket.getFiles({ prefix: `clips/${twitchLogin}/` });
    const existingGifs = new Set(files.filter(f => f.name.endsWith('.gif')).map(f => {
      const parts = f.name.split('/');
      return parts[parts.length - 1].replace('.gif', '');
    }));
    
    // Find first clip we don't have
    const newClip = clips.find(c => !existingGifs.has(c.id));
    if (!newClip) return;
    
    const gifUrl = await convertClipToGif(
      newClip.url,
      newClip.id,
      twitchLogin,
      Math.min(newClip.duration, 60),
      'stream',
      { serverId }
    );

    if (gifUrl) {
      // Delete oldest if we have 10+
      const gifs = files.filter(f => f.name.endsWith('.gif'));
      if (gifs.length >= 10) {
        await gifs[0].delete();
        // Also delete corresponding MP4
        const mp4Name = gifs[0].name.replace('.gif', '.mp4');
        await bucket.file(mp4Name).delete().catch(() => {});
      }
      
      await setLastClipFetch(serverId, userId, now);
      console.log(`[ClipFetching] Fetched new clip for ${twitchLogin}`);
    }
  } catch (error) {
    console.error(`[ClipFetching] Error for ${twitchLogin}:`, error);
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
  const userDoc = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId).get();
  const twitchLogin = userDoc.data()?.twitchLogin;
  if (!twitchLogin) return null;

  const { storage } = await import('@/firebase/server-init');
  const bucket = storage.bucket();
  const [files] = await bucket.getFiles({ prefix: `clips/${twitchLogin}/` });
  
  const gifs = files.filter(f => f.name.endsWith('.gif'));
  if (gifs.length === 0) return null;

  const stateDoc = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('shoutoutState').doc('current').get();
  const currentIndex = stateDoc.data()?.currentClipIndex || 0;

  const file = gifs[currentIndex % gifs.length];
  const [url] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });

  return {
    clipId: file.name.split('/').pop()?.replace('.gif', '') || '',
    gifUrl: url,
    twitchLogin,
    title: 'Clip',
    createdAt: new Date().toISOString(),
    cachedAt: new Date().toISOString()
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
    .map(doc => ({
      discordUserId: doc.id,
      twitchLogin: doc.data().twitchLogin,
      group: doc.data().group
    }))
    .filter(u => u.twitchLogin && (u.group === 'Crew' || u.group === 'Partners'));
}
