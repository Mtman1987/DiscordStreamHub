'use server';

import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getStoragePath } from './runtime-config';

type MediaRequest = {
  username: string;
  mediaType: 'gif' | 'image';
  contentType: 'shoutout' | 'spotlight' | 'vip' | 'calendar' | 'leaderboard';
  serverId?: string;
};

export async function getMediaForUser(request: MediaRequest): Promise<string | null> {
  if (request.mediaType !== 'gif') {
    return null;
  }

  const normalizedName = request.username.trim().toLowerCase();
  const mediaDir = join(getStoragePath(), normalizedName);
  if (!existsSync(mediaDir)) {
    return null;
  }

  const files = (await readdir(mediaDir))
    .filter(file => file.toLowerCase().endsWith('.gif'))
    .sort();

  const latestGif = files.at(-1);
  if (!latestGif) {
    return null;
  }

  return `/api/media/${normalizedName}/${latestGif}`;
}
