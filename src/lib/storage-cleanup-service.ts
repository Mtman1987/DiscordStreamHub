'use server';

import { db } from '@/data/server-init';
import { localStorageService } from './local-storage-service';

class StorageCleanupService {
  private readonly CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  private readonly MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  async cleanupExpiredGifs(serverId: string): Promise<void> {
    try {
      console.log('Starting GIF cleanup...');

      const cacheRef = db.collection('servers').doc(serverId).collection('clipCache');
      const snapshot = await cacheRef.get();

      const expiredFiles: string[] = [];
      const batch = db.batch();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const cachedAt = new Date(data.cachedAt);
        const age = Date.now() - cachedAt.getTime();

        if (age > this.MAX_AGE_MS) {
          if (data.volumeFileName) {
            expiredFiles.push(data.volumeFileName);
          }
          batch.delete(doc.ref);
        }
      }

      for (const fileName of expiredFiles) {
        try {
          await localStorageService.deleteGif(fileName);
          console.log(`Deleted expired GIF: ${fileName}`);
        } catch (error) {
          console.error(`Failed to delete GIF ${fileName}:`, error);
        }
      }

      if (expiredFiles.length > 0) {
        await batch.commit();
        console.log(`Cleaned up ${expiredFiles.length} expired GIFs`);
      } else {
        console.log('No expired GIFs found');
      }

    } catch (error) {
      console.error('Error during GIF cleanup:', error);
    }
  }

  async getStorageUsage(serverId: string): Promise<{ count: number; totalSize: string }> {
    try {
      const { count, totalSize } = await localStorageService.getStorageUsage();
      return {
        count,
        totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`
      };
    } catch (error) {
      console.error('Error getting storage usage:', error);
      return { count: 0, totalSize: 'Error' };
    }
  }
}

export const storageCleanup = new StorageCleanupService();
