import { mkdir, writeFile, unlink, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getStoragePath } from './runtime-config';

const STORAGE_PATH = getStoragePath();

class LocalStorageService {
  private storagePath: string;

  constructor() {
    this.storagePath = STORAGE_PATH;
    this.ensureStorageDir();
  }

  private async ensureStorageDir() {
    try {
      if (!existsSync(this.storagePath)) {
        await mkdir(this.storagePath, { recursive: true });
      }
    } catch (error) {
      console.error('Error creating storage directory:', error);
    }
  }

  async uploadGifFromUrl(gifUrl: string, fileName: string): Promise<string> {
    try {
      await this.ensureStorageDir();
      
      let buffer: Buffer;
      
      if (gifUrl.startsWith('data:')) {
        const [, data] = gifUrl.split(',');
        buffer = Buffer.from(data, 'base64');
      } else {
        const response = await fetch(gifUrl);
        if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
        buffer = Buffer.from(await response.arrayBuffer());
      }
      
      const filePath = join(this.storagePath, fileName.includes('/') ? fileName : `${fileName}`);
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      
      await writeFile(filePath, buffer);
      
      return `/api/media/${fileName.includes('/') ? fileName : fileName}`;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  async deleteGif(fileName: string): Promise<void> {
    try {
      const filePath = join(this.storagePath, `${fileName}.gif`);
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch (error) {
      console.error('Error deleting GIF:', error);
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      const filePath = join(this.storagePath, path);
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  }

  async gifExists(fileName: string): Promise<boolean> {
    try {
      const filePath = join(this.storagePath, `${fileName}.gif`);
      return existsSync(filePath);
    } catch (error) {
      return false;
    }
  }

  getPublicUrl(fileName: string): string {
    return `/api/media/${fileName}.gif`;
  }

  generateFileName(clipId: string, streamerName: string): string {
    return `${streamerName.toLowerCase()}_${clipId}_${Date.now()}`;
  }

  async getStorageUsage(): Promise<{ count: number; totalSize: number }> {
    try {
      const files = await readdir(this.storagePath, { recursive: true });
      let totalSize = 0;
      let count = 0;

      for (const file of files) {
        const filePath = join(this.storagePath, file as string);
        try {
          const stats = await stat(filePath);
          if (stats.isFile()) {
            totalSize += stats.size;
            count++;
          }
        } catch {}
      }

      return { count, totalSize };
    } catch (error) {
      return { count: 0, totalSize: 0 };
    }
  }
}

const localStorageService = new LocalStorageService();
export { localStorageService };

export async function uploadGifFromUrl(gifUrl: string, fileName: string): Promise<string> {
  return localStorageService.uploadGifFromUrl(gifUrl, fileName);
}

export async function deleteGif(fileName: string): Promise<void> {
  return localStorageService.deleteGif(fileName);
}

export async function deleteStorageFile(path: string): Promise<void> {
  return localStorageService.deleteFile(path);
}

export async function gifExists(fileName: string): Promise<boolean> {
  return localStorageService.gifExists(fileName);
}

export async function getPublicUrl(fileName: string): Promise<string> {
  return localStorageService.getPublicUrl(fileName);
}

export async function generateFileName(clipId: string, streamerName: string): Promise<string> {
  return localStorageService.generateFileName(clipId, streamerName);
}

export async function uploadFileToVolume(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  return localStorageService.uploadGifFromUrl(`data:${contentType};base64,${buffer.toString('base64')}`, fileName);
}

export async function uploadToStorage(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  return localStorageService.uploadGifFromUrl(`data:${contentType};base64,${buffer.toString('base64')}`, fileName);
}

export async function saveFile(path: string, buffer: Buffer): Promise<string> {
  return localStorageService.uploadGifFromUrl(`data:image/png;base64,${buffer.toString('base64')}`, path);
}
