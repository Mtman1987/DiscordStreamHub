'use server';

import { db } from '@/firebase/server-init';
import { getUserByLogin, getClipsForUser } from './twitch-api-service';
import { convertClipToGif } from './gif-conversion-service';
import { generateFileName, deleteGif } from './firebase-storage-service';
import { isCommunityGroup, isVipGroup } from './group-utils';

interface ClipPool {
  vipClips: CachedClip[];
  communityClips: CachedClip[];
  lastVipUpload: string;
  lastCommunityUpload: string;
  currentVipIndex: number;
  currentCommunityIndex: number;
}

interface CachedClip {
  clipId: string;
  clipUrl: string;
  gifUrl: string;
  firebaseFileName: string;
  streamerName: string;
  title: string;
  createdAt: string;
  cachedAt: string;
}

class ClipRotationService {
  private readonly CLIPS_PER_DAY = 5;
  private readonly UPLOAD_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  async manageClipRotation(serverId: string): Promise<void> {
    const poolRef = db.collection('servers').doc(serverId).collection('clipPools').doc('main');
    const poolDoc = await poolRef.get();
    
    let pool: ClipPool = poolDoc.exists ? poolDoc.data() as ClipPool : {
      vipClips: [],
      communityClips: [],
      lastVipUpload: '',
      lastCommunityUpload: '',
      currentVipIndex: 0,
      currentCommunityIndex: 0,
    };

    // Check if we need new VIP clips
    if (this.shouldUploadNewClips(pool.lastVipUpload)) {
      await this.uploadVipClips(serverId, pool);
    }

    // Check if we need new Community clips
    if (this.shouldUploadNewClips(pool.lastCommunityUpload)) {
      await this.uploadCommunityClips(serverId, pool);
    }

    // Cleanup old clips
    await this.cleanupOldClips(pool);

    // Rotate current clips (every 5 minutes)
    this.rotateClips(pool);

    // Save updated pool
    await poolRef.set(pool);
  }

  private shouldUploadNewClips(lastUpload: string): boolean {
    if (!lastUpload) return true;
    return Date.now() - new Date(lastUpload).getTime() > this.UPLOAD_COOLDOWN_MS;
  }

  private async uploadVipClips(serverId: string, pool: ClipPool): Promise<void> {
    try {
      const vipUsers = await this.getOnlineVipUsers(serverId);
      const newClips: CachedClip[] = [];

      for (const user of vipUsers.slice(0, this.CLIPS_PER_DAY)) {
        const twitchUser = await getUserByLogin(user.username.toLowerCase());
        if (!twitchUser) continue;

        const clips = await getClipsForUser(twitchUser.id, 3);
        if (clips.length === 0) continue;

        const bestClip = clips[0]; // Most recent clip
        const gifUrl = await convertClipToGif(
          bestClip.url,
          bestClip.id,
          user.username,
          bestClip.duration,
          'stream',
          { serverId }
        );
        
        if (gifUrl) {
          const fileName = await generateFileName(bestClip.id, user.username);
          newClips.push({
            clipId: bestClip.id,
            clipUrl: bestClip.url,
            gifUrl,
            firebaseFileName: fileName,
            streamerName: user.username,
            title: bestClip.title,
            createdAt: bestClip.created_at,
            cachedAt: new Date().toISOString(),
          });
        }
      }

      pool.vipClips = [...pool.vipClips, ...newClips];
      pool.lastVipUpload = new Date().toISOString();
      console.log(`Uploaded ${newClips.length} new VIP clips`);

    } catch (error) {
      console.error('Error uploading VIP clips:', error);
    }
  }

  private async uploadCommunityClips(serverId: string, pool: ClipPool): Promise<void> {
    try {
      const communityUsers = await this.getOnlineCommunityUsers(serverId);
      const newClips: CachedClip[] = [];

      for (const user of communityUsers.slice(0, this.CLIPS_PER_DAY)) {
        const twitchUser = await getUserByLogin(user.username.toLowerCase());
        if (!twitchUser) continue;

        const clips = await getClipsForUser(twitchUser.id, 3);
        if (clips.length === 0) continue;

        const bestClip = clips[0];
        const gifUrl = await convertClipToGif(
          bestClip.url,
          bestClip.id,
          user.username,
          bestClip.duration,
          'stream',
          { serverId }
        );
        
        if (gifUrl) {
          const fileName = await generateFileName(bestClip.id, user.username);
          newClips.push({
            clipId: bestClip.id,
            clipUrl: bestClip.url,
            gifUrl,
            firebaseFileName: fileName,
            streamerName: user.username,
            title: bestClip.title,
            createdAt: bestClip.created_at,
            cachedAt: new Date().toISOString(),
          });
        }
      }

      pool.communityClips = [...pool.communityClips, ...newClips];
      pool.lastCommunityUpload = new Date().toISOString();
      console.log(`Uploaded ${newClips.length} new Community clips`);

    } catch (error) {
      console.error('Error uploading Community clips:', error);
    }
  }

  private async cleanupOldClips(pool: ClipPool): Promise<void> {
    const cutoffTime = Date.now() - this.CLEANUP_AGE_MS;

    // Cleanup VIP clips
    const expiredVipClips = pool.vipClips.filter(clip => 
      new Date(clip.cachedAt).getTime() < cutoffTime
    );
    
    for (const clip of expiredVipClips) {
      await deleteGif(clip.firebaseFileName);
    }
    
    pool.vipClips = pool.vipClips.filter(clip => 
      new Date(clip.cachedAt).getTime() >= cutoffTime
    );

    // Cleanup Community clips
    const expiredCommunityClips = pool.communityClips.filter(clip => 
      new Date(clip.cachedAt).getTime() < cutoffTime
    );
    
    for (const clip of expiredCommunityClips) {
      await deleteGif(clip.firebaseFileName);
    }
    
    pool.communityClips = pool.communityClips.filter(clip => 
      new Date(clip.cachedAt).getTime() >= cutoffTime
    );

    if (expiredVipClips.length > 0 || expiredCommunityClips.length > 0) {
      console.log(`Cleaned up ${expiredVipClips.length} VIP and ${expiredCommunityClips.length} Community clips`);
    }
  }

  private rotateClips(pool: ClipPool): void {
    if (pool.vipClips.length > 0) {
      pool.currentVipIndex = (pool.currentVipIndex + 1) % pool.vipClips.length;
    }
    
    if (pool.communityClips.length > 0) {
      pool.currentCommunityIndex = (pool.currentCommunityIndex + 1) % pool.communityClips.length;
    }
  }

  async getCurrentVipClip(serverId: string): Promise<CachedClip | null> {
    const poolDoc = await db.collection('servers').doc(serverId).collection('clipPools').doc('main').get();
    if (!poolDoc.exists) return null;

    const pool = poolDoc.data() as ClipPool;
    return pool.vipClips[pool.currentVipIndex] || null;
  }

  async getCurrentCommunityClip(serverId: string): Promise<CachedClip | null> {
    const poolDoc = await db.collection('servers').doc(serverId).collection('clipPools').doc('main').get();
    if (!poolDoc.exists) return null;

    const pool = poolDoc.data() as ClipPool;
    // Community spotlight includes both community and VIP clips
    const allClips = [...pool.communityClips, ...pool.vipClips];
    return allClips[pool.currentCommunityIndex % allClips.length] || null;
  }

  async getVipClipForUser(serverId: string, username: string): Promise<CachedClip | null> {
    const poolDoc = await db.collection('servers').doc(serverId).collection('clipPools').doc('main').get();
    if (!poolDoc.exists) return null;

    const pool = poolDoc.data() as ClipPool;
    return pool.vipClips.find(clip => 
      clip.streamerName.toLowerCase() === username.toLowerCase()
    ) || null;
  }

  private async getOnlineVipUsers(serverId: string): Promise<any[]> {
    const snapshot = await db
      .collection('servers')
      .doc(serverId)
      .collection('users')
      .where('isOnline', '==', true)
      .get();

    return snapshot.docs
      .map(doc => doc.data())
      .filter(user => isVipGroup(user.group));
  }

  private async getOnlineCommunityUsers(serverId: string): Promise<any[]> {
    const snapshot = await db
      .collection('servers')
      .doc(serverId)
      .collection('users')
      .where('isOnline', '==', true)
      .get();

    return snapshot.docs
      .map(doc => doc.data())
      .filter(user => isCommunityGroup(user.group));
  }
}

const clipRotationService = new ClipRotationService();

export async function manageClipRotation(serverId: string): Promise<void> {
  return clipRotationService.manageClipRotation(serverId);
}

export async function getCurrentVipClip(serverId: string): Promise<CachedClip | null> {
  return clipRotationService.getCurrentVipClip(serverId);
}

export async function getCurrentCommunityClip(serverId: string): Promise<CachedClip | null> {
  return clipRotationService.getCurrentCommunityClip(serverId);
}

export async function getVipClipForUser(serverId: string, username: string): Promise<CachedClip | null> {
  return clipRotationService.getVipClipForUser(serverId, username);
}
