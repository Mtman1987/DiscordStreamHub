'use server';

import { getStorage } from 'firebase-admin/storage';
import fetch from 'node-fetch';

class FirebaseStorageService {
  private bucket;

  constructor() {
    this.bucket = getStorage().bucket('studio-9468926194-e03ac.firebasestorage.app');
  }

  async uploadGifFromUrl(gifUrl: string, fileName: string): Promise<string> {
    try {
      let buffer: Buffer;
      let contentType = 'image/gif';
      
      if (gifUrl.startsWith('data:')) {
        // Handle base64 data URLs
        const [header, data] = gifUrl.split(',');
        if (header.includes('video/mp4')) {
          contentType = 'video/mp4';
        } else if (header.includes('image/gif')) {
          contentType = 'image/gif';
        }
        buffer = Buffer.from(data, 'base64');
      } else {
        // Download from URL
        const response = await fetch(gifUrl);
        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.statusText}`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
      }
      
      // Upload to Firebase Storage
      const file = this.bucket.file(fileName.includes('/') ? fileName : `clips/${fileName}`);
      await file.save(buffer, {
        metadata: {
          contentType,
          cacheControl: 'public, max-age=86400', // 24 hours
        },
      });

      // Make file publicly accessible
      await file.makePublic();

      // Return public URL
      const filePath = fileName.includes('/') ? fileName : `clips/${fileName}`;
      return `https://firebasestorage.googleapis.com/v0/b/${this.bucket.name}/o/${encodeURIComponent(filePath)}?alt=media`;

    } catch (error) {
      console.error('Error uploading file to Firebase Storage:', error);
      throw error;
    }
  }

  async deleteGif(fileName: string): Promise<void> {
    try {
      const file = this.bucket.file(`clips/${fileName}.gif`);
      await file.delete();
    } catch (error) {
      console.error('Error deleting GIF from Firebase Storage:', error);
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      await this.bucket.file(normalizedPath).delete({
        ignoreNotFound: true
      } as any);
    } catch (error) {
      console.error('Error deleting file from Firebase Storage:', error);
    }
  }

  async gifExists(fileName: string): Promise<boolean> {
    try {
      const file = this.bucket.file(`clips/${fileName}.gif`);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      return false;
    }
  }

  getPublicUrl(fileName: string): string {
    return `https://storage.googleapis.com/${this.bucket.name}/clips/${fileName}.gif`;
  }

  generateFileName(clipId: string, streamerName: string): string {
    return `${streamerName.toLowerCase()}_${clipId}_${Date.now()}`;
  }
}

const firebaseStorageService = new FirebaseStorageService();

export async function uploadGifFromUrl(gifUrl: string, fileName: string): Promise<string> {
  return firebaseStorageService.uploadGifFromUrl(gifUrl, fileName);
}

export async function deleteGif(fileName: string): Promise<void> {
  return firebaseStorageService.deleteGif(fileName);
}

export async function deleteStorageFile(path: string): Promise<void> {
  return firebaseStorageService.deleteFile(path);
}

export async function gifExists(fileName: string): Promise<boolean> {
  return firebaseStorageService.gifExists(fileName);
}

export async function getPublicUrl(fileName: string): Promise<string> {
  return firebaseStorageService.getPublicUrl(fileName);
}

export async function generateFileName(clipId: string, streamerName: string): Promise<string> {
  return firebaseStorageService.generateFileName(clipId, streamerName);
}

export async function uploadFileToFirebase(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  return firebaseStorageService.uploadGifFromUrl(`data:${contentType};base64,${buffer.toString('base64')}`, fileName);
}

export async function uploadToStorage(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  return firebaseStorageService.uploadGifFromUrl(`data:${contentType};base64,${buffer.toString('base64')}`, fileName);
}
