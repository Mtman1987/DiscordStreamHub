import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getStoragePath } from './runtime-config';

const EMBED_STORAGE_PATH = join(getStoragePath(), 'embeds');

interface EmbedData {
  [userId: string]: {
    embed: any;
    updatedAt: number;
  };
}

const writeLocks = new Map<string, Promise<void>>();

async function ensureDir() {
  if (!existsSync(EMBED_STORAGE_PATH)) {
    await mkdir(EMBED_STORAGE_PATH, { recursive: true });
  }
}

function getFilePath(serverId: string): string {
  return join(EMBED_STORAGE_PATH, `${serverId}.json`);
}

function safeParseJSON(content: string): EmbedData {
  try {
    const data = JSON.parse(content);
    if (data && typeof data === 'object') return data;
  } catch (e) {
    console.error('[EmbedStorage] Corrupted JSON detected, resetting file');
  }
  return {};
}

async function safeWriteFile(filePath: string, data: EmbedData): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const json = JSON.stringify(data, null, 0);
  JSON.parse(json);
  await writeFile(tmpPath, json, 'utf-8');
  await rename(tmpPath, filePath);
}

async function withLock(serverId: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeLocks.get(serverId) || Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(serverId, next);
  await next;
}

async function readEmbedData(filePath: string): Promise<EmbedData> {
  if (!existsSync(filePath)) return {};
  const content = await readFile(filePath, 'utf-8');
  return safeParseJSON(content);
}

export async function setUserEmbed(serverId: string, userId: string, embed: any): Promise<void> {
  await withLock(serverId, async () => {
    try {
      await ensureDir();
      const filePath = getFilePath(serverId);
      const data = await readEmbedData(filePath);
      data[userId] = { embed, updatedAt: Date.now() };
      await safeWriteFile(filePath, data);
    } catch (error) {
      console.error('[EmbedStorage] Error saving embed:', error);
    }
  });
}

export async function getUserEmbed(serverId: string, userId: string): Promise<any | null> {
  try {
    const filePath = getFilePath(serverId);
    const data = await readEmbedData(filePath);
    return data[userId]?.embed || null;
  } catch (error) {
    console.error('[EmbedStorage] Error reading embed:', error);
    return null;
  }
}

export async function getAllUserEmbeds(serverId: string): Promise<Record<string, any>> {
  try {
    const filePath = getFilePath(serverId);
    const data = await readEmbedData(filePath);
    const result: Record<string, any> = {};
    for (const [userId, embedData] of Object.entries(data)) {
      result[userId] = embedData.embed;
    }
    return result;
  } catch (error) {
    console.error('[EmbedStorage] Error reading embeds:', error);
    return {};
  }
}

export async function clearUserEmbed(serverId: string, userId: string): Promise<void> {
  await withLock(serverId, async () => {
    try {
      const filePath = getFilePath(serverId);
      const data = await readEmbedData(filePath);
      delete data[userId];
      await safeWriteFile(filePath, data);
    } catch (error) {
      console.error('[EmbedStorage] Error clearing embed:', error);
    }
  });
}
