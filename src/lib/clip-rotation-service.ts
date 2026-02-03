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
          await saveClip(serverId, user.discordUserId, {
            clipId: clip.id,
            gifUrl,
            twitchLogin: user.twitchLogin,
            title: clip.title,
            createdAt: clip.created_at,
            cachedAt: new Date().toISOString()
          });
          successCount++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`[ClipFetching] ✅ Completed ${user.twitchLogin}`);
      
      // Rate limit: 2 seconds between users
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`[ClipFetching] ❌ Error for ${user.twitchLogin}:`, error);
    }
  }
  
  console.log('[ClipFetching] 🎉 Bulk fetch complete!');
}

export async function fetchNewClipOnLive(serverId: string, userId: string, twitchLogin: string): Promise<void> {
  try {
    const clipCount = await getClipCount(serverId, userId);
    
    // If no clips, fetch all 10
    if (clipCount === 0) {
      console.log(`[ClipFetching] New user ${twitchLogin}, fetching 10 clips`);
      await fetchAllClipsForUser(serverId, userId, twitchLogin);
      return;
    }

    // Otherwise check daily limit
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

    // Get existing clip IDs
    const existingClips = await db.collection('servers').doc(serverId)
      .collection('users').doc(userId)
      .collection('clips')
      .get();
    const existingIds = new Set(existingClips.docs.map(d => d.id));
    
    // Find first clip we don't have
    const newClip = clips.find(c => !existingIds.has(c.id));
    if (!newClip) return;
    
    const gifUrl = await convertClipToGif(
      newClip.url,
      mp4Url,
      newClip.id,
      twitchLogin,
      Math.min(newClip.duration, 60),
      'stream',
      { serverId }
    );

    if (gifUrl) {
      // Only delete if we have 5 or more clips (safety buffer)
      const currentCount = await getClipCount(serverId, userId);
      if (currentCount >= 5) {
        await deleteOldestClip(serverId, userId);
      }
      
      await saveClip(serverId, userId, {
        clipId: newClip.id,
        gifUrl,
        twitchLogin,
        title: newClip.title,
        createdAt: newClip.created_at,
        cachedAt: new Date().toISOString()
      });
      
      await setLastClipFetch(serverId, userId, now);
      console.log(`[ClipFetching] Fetched new clip for ${twitchLogin}`);
    }
  } catch (error) {
    console.error(`[ClipFetching] Error for ${twitchLogin}:`, error);
  }
}

async function fetchAllClipsForUser(serverId: string, userId: string, twitchLogin: string): Promise<void> {
  const twitchUser = await getUserByLogin(twitchLogin);
  if (!twitchUser) return;

  const clips = await getClipsForUser(twitchUser.id, 50);
  
  if (clips.length === 0) {
    console.log(`[ClipFetching] ${twitchLogin} has no clips available`);
    return;
  }
  
  console.log(`[ClipFetching] ${twitchLogin} has ${clips.length} clips available`);
  
  let successCount = 0;
  for (const clip of clips) {
    if (successCount >= 10) break;
    
    const gifUrl = await convertClipToGif(
      clip.url,
      mp4Url,
      clip.id,
      twitchLogin,
      Math.min(clip.duration, 60),
      'stream',
      { serverId }
    );

    if (gifUrl && !gifUrl.includes('tenor.com')) {
      await saveClip(serverId, userId, {
        clipId: clip.id,
        gifUrl,
        twitchLogin,
        title: clip.title,
        createdAt: clip.created_at,
        cachedAt: new Date().toISOString()
      });
      successCount++;
    }
  }
  
  await setLastClipFetch(serverId, userId, Date.now());
  console.log(`[ClipFetching] Fetched ${successCount} clips for new user ${twitchLogin}`);
}

async function getClipCount(serverId: string, userId: string): Promise<number> {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('clips')
    .get();
  return snapshot.size;
}

async function saveClip(serverId: string, userId: string, clip: CachedClip): Promise<void> {
  await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('clips').doc(clip.clipId)
    .set(clip);
}

async function deleteOldestClip(serverId: string, userId: string): Promise<void> {
  const clipsSnapshot = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('clips')
    .orderBy('cachedAt', 'asc')
    .limit(1)
    .get();

  if (!clipsSnapshot.empty) {
    const oldestDoc = clipsSnapshot.docs[0];
    const data = oldestDoc.data() as CachedClip;
    
    // Extract filename from gifUrl
    const urlParts = data.gifUrl.split('/');
    const filename = urlParts[urlParts.length - 1].replace('.gif', '');
    await deleteGif(filename);
    
    await oldestDoc.ref.delete();
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
  const stateDoc = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('shoutoutState').doc('current').get();
  
  const currentIndex = stateDoc.data()?.currentClipIndex || 0;
  
  const clipsSnapshot = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('clips')
    .orderBy('cachedAt', 'desc')
    .get();

  if (clipsSnapshot.empty) return null;
  
  const clips = clipsSnapshot.docs.map(doc => doc.data() as CachedClip);
  return clips[currentIndex % clips.length] || null;
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
    .filter(u => u.twitchLogin && (u.group === 'Crew' || u.group === 'Partners' || u.group === 'Vip'));
}
