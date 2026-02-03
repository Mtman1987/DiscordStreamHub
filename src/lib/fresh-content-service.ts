'use server';

import { db } from '@/firebase/server-init';

interface FreshContentBatch {
  username: string;
  gifs: string[];
  batchTimestamp: number;
  streamStartTime: number;
  currentIndex: number;
  isComplete: boolean; // true when we have all 6 clips
}

class FreshContentService {
  
  async handleStreamerGoesLive(username: string, serverId: string): Promise<void> {
    console.log(`🔴 ${username} went live - checking fresh content status`);
    
    const batchRef = db.collection('servers').doc(serverId).collection('freshContent').doc(username.toLowerCase());
    const batch = await batchRef.get();
    
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    
    if (!batch.exists || batch.data()?.batchTimestamp < oneDayAgo) {
      // Need fresh content - clear old and start new batch
      console.log(`🗑️ Clearing old content for ${username}, starting fresh batch`);
      
      await batchRef.set({
        username: username.toLowerCase(),
        gifs: [],
        batchTimestamp: now,
        streamStartTime: now,
        currentIndex: 0,
        isComplete: false
      });
      
      // Schedule first clip capture in 10 minutes
      this.scheduleNextClipCapture(username, serverId, 0);
    } else {
      // Use existing batch, reset rotation
      console.log(`♻️ Using existing fresh batch for ${username} (${batch.data()?.gifs.length} clips)`);
      await batchRef.update({
        streamStartTime: now,
        currentIndex: 0
      });
    }
  }
  
  private scheduleNextClipCapture(username: string, serverId: string, clipNumber: number): void {
    if (clipNumber >= 6) return; // Max 6 clips per day
    
    const delay = 10 * 60 * 1000; // 10 minutes
    console.log(`⏰ Scheduling clip ${clipNumber + 1}/6 for ${username} in 10 minutes`);
    
    setTimeout(async () => {
      await this.captureClipForBatch(username, serverId, clipNumber);
    }, delay);
  }
  
  private async captureClipForBatch(username: string, serverId: string, clipNumber: number): Promise<void> {
    try {
      console.log(`📹 Capturing clip ${clipNumber + 1}/6 for ${username}`);
      
      // Get current stream clip
      const clipUrl = await this.getCurrentStreamClip(username);
      if (!clipUrl) {
        console.log(`❌ No clip available for ${username}, skipping`);
        return;
      }
      
      // Convert to GIF (this will use your existing conversion logic)
      const { convertClipToGif } = await import('./gif-conversion-service');
      const gifUrl = await convertClipToGif(
        clipUrl,
        `fresh_${Date.now()}`,
        username,
        10,
        'stream',
        { serverId }
      );
      
      if (!gifUrl) {
        console.log(`❌ Failed to convert clip for ${username}`);
        return;
      }
      
      // Add to batch
      const batchRef = db.collection('servers').doc(serverId).collection('freshContent').doc(username.toLowerCase());
      const batch = await batchRef.get();
      
      if (batch.exists) {
        const data = batch.data() as FreshContentBatch;
        const updatedGifs = [...data.gifs, gifUrl];
        const isComplete = updatedGifs.length >= 6;
        
        await batchRef.update({
          gifs: updatedGifs,
          isComplete
        });
        
        console.log(`✅ Added clip ${updatedGifs.length}/6 for ${username}`);
        
        // Schedule next clip if not complete
        if (!isComplete) {
          this.scheduleNextClipCapture(username, serverId, clipNumber + 1);
        } else {
          console.log(`🎉 Fresh content batch complete for ${username} (6/6 clips)`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error capturing clip for ${username}:`, error);
    }
  }
  
  async getFreshContentForShoutout(username: string, serverId: string): Promise<string | null> {
    const batchRef = db.collection('servers').doc(serverId).collection('freshContent').doc(username.toLowerCase());
    const batch = await batchRef.get();
    
    if (!batch.exists) return null;
    
    const data = batch.data() as FreshContentBatch;
    
    // Check if batch is still valid (within 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    if (data.batchTimestamp < oneDayAgo) {
      console.log(`⏰ Fresh content expired for ${username}`);
      return null;
    }
    
    if (data.gifs.length === 0) return null;
    
    // Rotate through the available clips
    const currentGif = data.gifs[data.currentIndex];
    const nextIndex = (data.currentIndex + 1) % data.gifs.length;
    
    // Update rotation index
    await batchRef.update({ currentIndex: nextIndex });
    
    console.log(`🎬 Serving fresh content for ${username} (clip ${data.currentIndex + 1}/${data.gifs.length})`);
    return currentGif;
  }
  
  private async getCurrentStreamClip(username: string): Promise<string | null> {
    try {
      // Get recent clips from Twitch API
      const { getTwitchClips } = await import('./twitch-service');
      const clips = await getTwitchClips(username, 1); // Get most recent clip
      
      return clips.length > 0 ? clips[0].url : null;
    } catch (error) {
      console.error(`Error getting clips for ${username}:`, error);
      return null;
    }
  }
  
  async cleanupExpiredContent(serverId: string): Promise<void> {
    console.log('🧹 Cleaning up expired fresh content...');
    
    const freshContentRef = db.collection('servers').doc(serverId).collection('freshContent');
    const expired = await freshContentRef.where('batchTimestamp', '<', Date.now() - (24 * 60 * 60 * 1000)).get();
    
    const batch = db.batch();
    expired.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    if (!expired.empty) {
      await batch.commit();
      console.log(`🗑️ Cleaned up ${expired.size} expired fresh content batches`);
    }
  }
}

const freshContentService = new FreshContentService();

export async function handleStreamerGoesLive(username: string, serverId: string): Promise<void> {
  return freshContentService.handleStreamerGoesLive(username, serverId);
}

export async function getFreshContentForShoutout(username: string, serverId: string): Promise<string | null> {
  return freshContentService.getFreshContentForShoutout(username, serverId);
}

export async function cleanupExpiredContent(serverId: string): Promise<void> {
  return freshContentService.cleanupExpiredContent(serverId);
}