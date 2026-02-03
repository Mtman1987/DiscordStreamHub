'use server';

import { db } from '@/firebase/server-init';
import { getUserByLogin, getClipsForUser } from './twitch-api-service';
import { uploadToStorage } from './firebase-storage-service';
import fetch from 'node-fetch';

interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  title: string;
  thumbnail_url: string;
  duration: number;
  created_at: string;
}

interface ConvertedGif {
  gifUrl: string;
  clipUrl: string;
  clipTitle: string;
  broadcasterName: string;
}

/**
 * FreeConvert API Integration
 * Converts video URLs to GIF format using their cloud API
 */
class FreeConvertService {
  private apiKey: string;
  private baseUrl = 'https://api.freeconvert.com/v1';

  constructor() {
    this.apiKey = process.env.FREE_CONVERT_API_KEY || '';
  }

  private isConfigured(): boolean {
    if (!this.apiKey) {
      console.warn('[FreeConvert] API key not configured. Service is disabled.');
      return false;
    }
    return true;
  }

  private async makeApiRequest(url: string, options: any): Promise<any> {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorBody = await response.text();
      // This is crucial: we are now showing the actual error page content.
      throw new Error(`FreeConvert API Error (${response.status}): ${errorBody}`);
    }
    return response.json();
  }

  /**
   * Import video from URL
   */
  private async importFromUrl(videoUrl: string): Promise<string> {
    const data = await this.makeApiRequest(
      `${this.baseUrl}/process/import/url`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: videoUrl,
          filename: `clip_${Date.now()}.mp4`
        })
      }
    );
    return data.id;
  }

  /**
   * Convert video to GIF
   */
  private async convertToGif(taskId: string, options?: {
    width?: number;
    fps?: number;
    duration?: number;
  }): Promise<string> {
    const data = await this.makeApiRequest(
      `${this.baseUrl}/process/convert`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: taskId,
          output_format: 'gif',
          options: {
            video_codec: 'gif',
            width: options?.width || 640,
            fps: options?.fps || 15,
            ...(options?.duration && { duration: options.duration })
          }
        })
      }
    );
    return data.id;
  }

  /**
   * Wait for task to complete and get download URL
   */
  private async waitForTask(taskId: string, maxWaitMs: number = 60000): Promise<string> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < maxWaitMs) {
      const data = await this.makeApiRequest(
        `${this.baseUrl}/process/tasks/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );
      
      const status = data.status;

      if (status === 'completed') {
        return data.result.url;
      } else if (status === 'failed' || status === 'error') {
        throw new Error(`Task failed: ${data.message || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Task timeout - conversion took too long');
  }

  /**
   * Download file from URL
   */
  private async downloadFile(url: string): Promise<Buffer> {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP Error downloading file: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
  }

  /**
   * Full conversion pipeline: URL -> GIF -> Buffer
   */
  async convertVideoUrlToGif(videoUrl: string, options?: {
    width?: number;
    fps?: number;
    duration?: number;
  }): Promise<Buffer | null> {
    if (!this.isConfigured()) {
        throw new Error('FreeConvert API Key is not configured. Please set FREE_CONVERT_API_KEY in your .env file.');
    }
    console.log('[FreeConvert] Starting conversion:', videoUrl);

    // Step 1: Import video from URL
    const importTaskId = await this.importFromUrl(videoUrl);
    console.log('[FreeConvert] Import task created:', importTaskId);

    // Wait for import to complete
    await this.waitForTask(importTaskId);
    console.log('[FreeConvert] Import completed');

    // Step 2: Convert to GIF
    const convertTaskId = await this.convertToGif(importTaskId, options);
    console.log('[FreeConvert] Conversion task created:', convertTaskId);

    // Wait for conversion to complete and get download URL
    const downloadUrl = await this.waitForTask(convertTaskId);
    console.log('[FreeConvert] Conversion completed, downloading...');

    // Step 3: Download the converted GIF
    const gifBuffer = await this.downloadFile(downloadUrl);
    console.log('[FreeConvert] Download completed, size:', gifBuffer.length, 'bytes');

    return gifBuffer;
  }
}

const freeConvertService = new FreeConvertService();

/**
 * Get a recent clip from a Twitch user
 */
async function getRecentClipForUser(username: string): Promise<TwitchClip | null> {
  try {
    const twitchUser = await getUserByLogin(username.toLowerCase());
    if (!twitchUser) {
      console.log(`[ServerFallback] Twitch user ${username} not found`);
      return null;
    }

    const clips = await getClipsForUser(twitchUser.id, 5);
    if (clips.length === 0) {
      console.log(`[ServerFallback] No clips found for ${username}`);
      return null;
    }

    // Return the most recent clip
    return clips[0];
  } catch (error) {
    console.error(`[ServerFallback] Error fetching clip for ${username}:`, error);
    return null;
  }
}

/**
 * Convert Twitch clip to GIF and upload to Firebase Storage
 */
async function convertClipToGif(clip: TwitchClip, serverId: string): Promise<ConvertedGif | null> {
  try {
    console.log(`[ServerFallback] Converting clip to GIF:`, clip.url);

    // Get the MP4 URL from the Twitch clip
    // Twitch clips have a thumbnail URL pattern we can use to derive the MP4 URL
    const clipId = clip.id;
    const mp4Url = `https://clips-media-assets2.twitch.tv/${clipId}.mp4`;

    // Convert using FreeConvert API
    const gifBuffer = await freeConvertService.convertVideoUrlToGif(mp4Url, {
      width: 640,
      fps: 15,
      duration: Math.min(clip.duration, 30) // Max 30 seconds
    });

    if (!gifBuffer) {
        throw new Error('GIF conversion returned an empty buffer. API key might be missing or invalid.');
    }

    // Upload to Firebase Storage
    const filename = `serverside-fallback/${serverId}/${clipId}_${Date.now()}.gif`;
    const gifUrl = await uploadToStorage(gifBuffer, filename, 'image/gif');

    console.log(`[ServerFallback] GIF uploaded successfully:`, gifUrl);

    return {
      gifUrl,
      clipUrl: clip.url,
      clipTitle: clip.title,
      broadcasterName: clip.broadcaster_name
    };
  } catch (error) {
    console.error('[ServerFallback] Failed to convert clip to GIF:', error);
    return null;
  }
}

/**
 * Generate spotlight content using server-side fallback
 * This is called when the local server is offline (no puppeteer/ffmpeg)
 */
export async function generateSpotlightServerSideFallback(serverId: string): Promise<ConvertedGif | null> {
  try {
    console.log(`[ServerFallback] Starting server-side fallback for ${serverId}`);

    // Get all community members
    const usersRef = db.collection('servers').doc(serverId).collection('users');
    const snapshot = await usersRef.get();

    const communityMembers = snapshot.docs
      .filter(doc => {
        const group = doc.data().group;
        return group === 'community' || group === 'vip' || group === 'crew';
      })
      .map(doc => ({
        userId: doc.id,
        username: doc.data().username as string
      }))
      .filter(member => Boolean(member.username));

    if (communityMembers.length === 0) {
      console.log('[ServerFallback] No community members found');
      return null;
    }

    // Try to get clips from multiple members until we succeed
    for (const member of communityMembers) {
      const clip = await getRecentClipForUser(member.username);
      
      if (clip) {
        const converted = await convertClipToGif(clip, serverId);
        
        if (converted) {
          // Store in database for future use
          await db.collection('servers')
            .doc(serverId)
            .collection('users')
            .doc(member.userId)
            .update({
              lastServerSideFallbackClip: {
                gifUrl: converted.gifUrl,
                clipUrl: converted.clipUrl,
                clipTitle: converted.clipTitle,
                createdAt: new Date().toISOString()
              }
            });

          return converted;
        }
      }
    }

    console.log('[ServerFallback] Could not generate content from any community member');
    return null;
  } catch (error) {
    console.error('[ServerFallback] Server-side fallback failed:', error);
    return null;
  }
}

/**
 * Update spotlight using server-side fallback
 * Stores the GIF URL in the database to be used by the normal flow
 */
export async function updateSpotlightWithServerSideFallback(serverId: string): Promise<boolean> {
  try {
    const converted = await generateSpotlightServerSideFallback(serverId);
    
    if (!converted) {
      console.log('[ServerFallback] No content generated');
      return false;
    }

    // Update the spotlight document with the converted GIF
    const spotlightRef = db.collection('servers').doc(serverId).collection('spotlight').doc('current');
    
    await spotlightRef.set({
      streamerName: converted.broadcasterName,
      cardGifUrl: converted.gifUrl,
      clipUrl: converted.clipUrl,
      clipTitle: converted.clipTitle,
      lastUpdated: new Date().toISOString(),
      generatedBy: 'server-side-fallback',
      streamData: {
        title: converted.clipTitle,
        game: 'Recent Clip',
        viewers: 0,
        avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/default_profile_image-300x300.png'
      }
    }, { merge: true });

    console.log('[ServerFallback] Spotlight updated successfully');
    return true;
  } catch (error) {
    console.error('[ServerFallback] Failed to update spotlight:', error);
    return false;
  }
}

export { freeConvertService };
