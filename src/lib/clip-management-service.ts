'use server';

import { db } from "@/firebase/server-init";
import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { deleteGif } from "./firebase-storage-service";
import { DAILY_CLIP_LIMIT } from "./clip-settings";

interface ClipRecord {
  gifUrl: string;
  mp4Url: string;
  createdAt: Date;
  streamTitle: string;
  gameName: string;
}

type ClipInput = { gifUrl: string; mp4Url: string; streamTitle: string; gameName: string };
type UserLookup = { userId?: string; username?: string };

async function resolveUserDoc(
  serverId: string,
  lookup: UserLookup
): Promise<{ ref: DocumentReference | null; snapshot: DocumentSnapshot | null }> {
  const usersRef = db.collection('servers').doc(serverId).collection('users');

  const tryDoc = async (docId?: string) => {
    if (!docId) return null;
    const ref = usersRef.doc(docId);
    const snap = await ref.get();
    return snap.exists ? { ref, snapshot: snap } : null;
  };

  const direct = await tryDoc(lookup.userId ?? lookup.username);
  if (direct) return direct;

  if (lookup.username) {
    const usernameLower = lookup.username.toLowerCase();
    const byExact = await usersRef.where('username', '==', lookup.username).limit(1).get();
    if (!byExact.empty) {
      const snap = byExact.docs[0];
      return { ref: snap.ref, snapshot: snap };
    }
    const byLower = await usersRef.where('usernameLower', '==', usernameLower).limit(1).get();
    if (!byLower.empty) {
      const snap = byLower.docs[0];
      return { ref: snap.ref, snapshot: snap };
    }
  }

  console.warn(
    `[ClipManager] Unable to resolve user doc for ${lookup.username ?? lookup.userId} in server ${serverId}`
  );
  return { ref: null, snapshot: null };
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function manageUserClips(
  serverId: string, 
  lookup: UserLookup, 
  newClip: ClipInput
): Promise<{ shouldCreateNew: boolean; clipToUse?: ClipRecord }> {

  const { ref: userRef, snapshot: userDoc } = await resolveUserDoc(serverId, lookup);
  if (!userRef || !userDoc?.exists) {
    return { shouldCreateNew: true };
  }
  
  const userData = userDoc.data();
  const existingClips: ClipRecord[] = userData?.dailyClips || [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Filter clips from today only
  const todaysClips = existingClips.filter(clip => {
    const clipDate = toDate(clip.createdAt);
    if (!clipDate) return false;
    const clipDay = new Date(clipDate.getFullYear(), clipDate.getMonth(), clipDate.getDate());
    return clipDay.getTime() === today.getTime();
  });
  
  // Clean up old clips (older than 24 hours)
  const oldClips = existingClips.filter(clip => {
    const clipDate = toDate(clip.createdAt);
    if (!clipDate) return false;
    const clipDay = new Date(clipDate.getFullYear(), clipDate.getMonth(), clipDate.getDate());
    return clipDay.getTime() !== today.getTime();
  });
  
  // Delete old clips from Firebase Storage
  for (const oldClip of oldClips) {
    try {
      // Extract filename from URL for deletion
      const gifFileName = oldClip.gifUrl.split('/').pop()?.split('?')[0];
      if (gifFileName) {
        await deleteGif(decodeURIComponent(gifFileName));
      }
    } catch (error) {
      console.log(`Failed to delete old clip: ${error}`);
    }
  }
  
  // Check if we've hit the daily limit
  if (todaysClips.length >= DAILY_CLIP_LIMIT) {
    // Rotate through existing clips
    const clipIndex = Math.floor(Math.random() * todaysClips.length);
    const selectedClip = todaysClips[clipIndex];
    
    console.log(`[ClipManager] User ${lookup.username ?? lookup.userId} hit daily limit (${DAILY_CLIP_LIMIT}), using existing clip ${clipIndex + 1}/${todaysClips.length}`);
    
    return { 
      shouldCreateNew: false, 
      clipToUse: selectedClip 
    };
  }
  
  console.log(`[ClipManager] ${lookup.username ?? lookup.userId} has ${todaysClips.length}/${DAILY_CLIP_LIMIT} clips today`);

  // Add new clip to today's collection
  const newClipRecord: ClipRecord = {
    ...newClip,
    createdAt: now
  };
  
  const updatedClips = [...todaysClips, newClipRecord];
  
  // Update user document with new clips array
  await userRef.update({
    dailyClips: updatedClips,
    lastClipUpdate: now
  });
  
  console.log(`[ClipManager] Created new clip for ${lookup.username ?? lookup.userId} (${updatedClips.length}/${DAILY_CLIP_LIMIT} today)`);
  
  return { shouldCreateNew: true };
}

export async function getUserTodaysClips(serverId: string, lookup: UserLookup): Promise<ClipRecord[]> {
  const { snapshot } = await resolveUserDoc(serverId, lookup);
  
  if (!snapshot?.exists) {
    return [];
  }
  
  const userData = snapshot.data();
  const existingClips: ClipRecord[] = userData?.dailyClips || [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Return only today's clips
  return existingClips.filter(clip => {
    const clipDate = toDate(clip.createdAt);
    if (!clipDate) return false;
    const clipDay = new Date(clipDate.getFullYear(), clipDate.getMonth(), clipDate.getDate());
    return clipDay.getTime() === today.getTime();
  });
}

export async function cleanupAllOldClips(serverId: string): Promise<number> {
  const usersRef = db.collection('servers').doc(serverId).collection('users');
  const snapshot = await usersRef.where('dailyClips', '!=', null).get();
  
  let cleanedCount = 0;
  const batch = db.batch();
  
  for (const doc of snapshot.docs) {
    const userData = doc.data();
    const existingClips: ClipRecord[] = userData.dailyClips || [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Separate today's clips from old clips
    const todaysClips = existingClips.filter(clip => {
      const clipDate = toDate(clip.createdAt);
      if (!clipDate) return false;
      const clipDay = new Date(clipDate.getFullYear(), clipDate.getMonth(), clipDate.getDate());
      return clipDay.getTime() === today.getTime();
    });
    
    const oldClips = existingClips.filter(clip => {
      const clipDate = toDate(clip.createdAt);
      if (!clipDate) return false;
      const clipDay = new Date(clipDate.getFullYear(), clipDate.getMonth(), clipDate.getDate());
      return clipDay.getTime() !== today.getTime();
    });
    
    if (oldClips.length > 0) {
      // Delete old clips from Firebase Storage
      for (const oldClip of oldClips) {
        try {
          const gifFileName = oldClip.gifUrl.split('/').pop()?.split('?')[0];
          if (gifFileName) {
            await deleteGif(decodeURIComponent(gifFileName));
          }
        } catch (error) {
          console.log(`Failed to delete old clip: ${error}`);
        }
      }
      
      // Update user document to keep only today's clips
      batch.update(doc.ref, { dailyClips: todaysClips });
      cleanedCount += oldClips.length;
    }
  }
  
  await batch.commit();
  console.log(`[ClipManager] Cleaned up ${cleanedCount} old clips`);
  
  return cleanedCount;
}

export async function getRandomClipFromPool(serverId: string, lookup: UserLookup): Promise<ClipRecord | null> {
  const todaysClips = await getUserTodaysClips(serverId, lookup);
  if (!todaysClips.length) {
    console.log(`[ClipManager] No cached clips for ${lookup.username ?? lookup.userId}`);
    return null;
  }
  const idx = Math.floor(Math.random() * todaysClips.length);
  const selected = todaysClips[idx];
  console.log(`[ClipManager] Reusing cached clip ${idx + 1}/6 for ${lookup.username ?? lookup.userId}`);
  return selected;
}

export async function addClipToPool(serverId: string, lookup: UserLookup, clip: ClipInput): Promise<void> {
  const { ref: userRef, snapshot: userDoc } = await resolveUserDoc(serverId, lookup);
  if (!userRef || !userDoc?.exists) {
    return;
  }
  const now = new Date();
  const existing: ClipRecord[] = userDoc.data()?.dailyClips || [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todaysClips = existing.filter(clip => {
    const clipDate = toDate(clip.createdAt);
    if (!clipDate) return false;
    const clipDay = new Date(clipDate.getFullYear(), clipDate.getMonth(), clipDate.getDate());
    return clipDay.getTime() === today.getTime();
  });

  const newClipRecord: ClipRecord = {
    ...clip,
    createdAt: now
  };

  const updatedClips = [...todaysClips, newClipRecord].slice(-DAILY_CLIP_LIMIT);

  await userRef.update({
    dailyClips: updatedClips,
    lastClipUpdate: now
  });
}

export async function deleteClipFromPool(serverId: string, lookup: UserLookup, gifUrl: string): Promise<boolean> {
  try {
    const { ref: userRef, snapshot: userDoc } = await resolveUserDoc(serverId, lookup);
    if (!userRef || !userDoc?.exists) {
      return false;
    }

    const userData = userDoc.data();
    const existingClips: ClipRecord[] = userData?.dailyClips || [];
    
    // Remove the clip with matching GIF URL
    const updatedClips = existingClips.filter(clip => clip.gifUrl !== gifUrl);
    
    if (updatedClips.length === existingClips.length) {
      return false; // No clip was found to delete
    }

    // Update user document
    await userRef.update({
      dailyClips: updatedClips,
      lastClipUpdate: new Date()
    });

    // Delete from Firebase Storage
    try {
      const gifFileName = gifUrl.split('/').pop()?.split('?')[0];
      if (gifFileName) {
        await deleteGif(decodeURIComponent(gifFileName));
      }
    } catch (error) {
      console.log(`Failed to delete GIF from storage: ${error}`);
    }

    console.log(`[ClipManager] Deleted clip for ${lookup.username ?? lookup.userId}`);
    return true;
  } catch (error) {
    console.error('Error deleting clip:', error);
    return false;
  }
}
