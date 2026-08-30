import { existsSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getAppUrl, getChatTagApiBase, getStoragePath } from '@/lib/runtime-config';

export const NEBULA_GAMEPLAY_ROTATION_MS = 10 * 60 * 1000;
export const NEBULA_GAMEPLAY_DIRECTORY = 'nebula-arcade';

export type NebulaGameplayMetadata = {
  id: string;
  name: string;
  order: number;
  revision: string;
  captureSeconds: number;
  capturedAt: string;
  sourceUrl: string;
};

export type NebulaGameplayItem = NebulaGameplayMetadata & {
  fileName: string;
  mediaUrl: string;
  modifiedAt: number;
};

export function normalizeNebulaGameId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function getNebulaGameplaySlot(now = Date.now()): number {
  return Math.floor(now / NEBULA_GAMEPLAY_ROTATION_MS);
}

export function resolveNebulaGameplayNow(requestedSlot: string | null, now = Date.now()): number {
  if (requestedSlot === null || requestedSlot.trim() === '') return now;
  const slot = Number(requestedSlot);
  return Number.isFinite(slot) && slot >= 0
    ? slot * NEBULA_GAMEPLAY_ROTATION_MS
    : now;
}

export function selectNebulaGameplay<T>(items: T[], now = Date.now()): T | null {
  if (!items.length) return null;
  return items[getNebulaGameplaySlot(now) % items.length] || null;
}

export function getNebulaGameplayFallbackUrl(): string {
  const base = getChatTagApiBase().replace(/\/$/, '');
  return `${base}/brand/nebula-arcade-games-showcase.gif?v=2`;
}

export async function getNebulaGameplayItems(): Promise<NebulaGameplayItem[]> {
  const directory = join(getStoragePath(), NEBULA_GAMEPLAY_DIRECTORY);
  if (!existsSync(directory)) return [];
  const files = (await readdir(directory).catch(() => [] as string[]))
    .filter((file) => file.endsWith('.gif'));
  const appUrl = getAppUrl().replace(/\/$/, '');
  const items: NebulaGameplayItem[] = [];

  for (const fileName of files) {
    const id = normalizeNebulaGameId(fileName.replace(/\.gif$/i, ''));
    if (!id) continue;
    const metaPath = join(directory, `${id}.gif.meta.json`);
    const filePath = join(directory, fileName);
    try {
      const [rawMetadata, fileStat] = await Promise.all([
        readFile(metaPath, 'utf8'),
        stat(filePath),
      ]);
      const metadata = JSON.parse(rawMetadata) as NebulaGameplayMetadata;
      items.push({
        id,
        name: String(metadata.name || id),
        order: Number.isFinite(Number(metadata.order)) ? Number(metadata.order) : 999,
        revision: String(metadata.revision || ''),
        captureSeconds: Number(metadata.captureSeconds || 60),
        capturedAt: String(metadata.capturedAt || fileStat.mtime.toISOString()),
        sourceUrl: String(metadata.sourceUrl || ''),
        fileName,
        modifiedAt: fileStat.mtimeMs,
        mediaUrl: `${appUrl}/api/media/${NEBULA_GAMEPLAY_DIRECTORY}/${encodeURIComponent(fileName)}?v=${Math.floor(fileStat.mtimeMs)}`,
      });
    } catch (error) {
      console.warn(`[NebulaGameplay] Ignoring incomplete capture ${fileName}:`, error);
    }
  }

  return items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}
