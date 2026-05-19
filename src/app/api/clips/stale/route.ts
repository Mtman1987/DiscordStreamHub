import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const STORAGE_PATH = process.env.STORAGE_PATH || '/data/clips';
const STALE_DAYS = 30;
const WORKER_SECRET = process.env.CLIP_WORKER_SECRET || process.env.BOT_SECRET_KEY || '1234';

// Folders that aren't streamer clips
const SKIP_FOLDERS = new Set(['banners', 'leaderboard', 'admin-calendar', 'admin-leaderboard', 'twitch', 'calendar']);

function normalizeLogin(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function readTimestamp(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function newestFolderActivityMs(folderPath: string): Promise<number> {
  let newest = readTimestamp((await stat(folderPath)).mtime);
  const files = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
  for (const file of files) {
    if (!file.isFile()) continue;
    const fileStat = await stat(join(folderPath, file.name)).catch(() => null);
    if (fileStat) newest = Math.max(newest, fileStat.mtimeMs);
  }
  return newest;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${WORKER_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serverId = request.nextUrl.searchParams.get('serverId') || process.env.HARDCODED_GUILD_ID || '';
  if (!serverId) {
    return NextResponse.json({ error: 'serverId required' }, { status: 400 });
  }

  try {
    if (!existsSync(STORAGE_PATH)) {
      return NextResponse.json({ stale: [] });
    }

    const folders = await readdir(STORAGE_PATH, { withFileTypes: true });
    const streamerFolders = folders.filter(f => f.isDirectory() && !SKIP_FOLDERS.has(f.name));

    const usersSnap = await db.collection('servers').doc(serverId).collection('users').get();
    const activeLogins = new Set<string>();
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      for (const value of [data.twitchLogin, data.twitchUsername, data.login, data.username]) {
        const login = normalizeLogin(value);
        if (login) activeLogins.add(login);
      }
    }

    const cutoff = Date.now() - (STALE_DAYS * 24 * 60 * 60 * 1000);
    const stale: Array<{ twitchLogin: string; lastLive: string | null; reason: string; newestFile: string | null }> = [];
    let protectedFolders = 0;

    for (const folder of streamerFolders) {
      const login = folder.name;
      const normalizedLogin = normalizeLogin(login);

      // If the folder belongs to any currently configured account, keep it.
      // A stale timestamp is not enough proof to delete a live user's clip cache.
      if (activeLogins.has(normalizedLogin)) {
        protectedFolders += 1;
        continue;
      }

      const folderPath = join(STORAGE_PATH, login);
      const newestActivityMs = await newestFolderActivityMs(folderPath);
      if (newestActivityMs === 0 || newestActivityMs >= cutoff) continue;

      stale.push({
        twitchLogin: login,
        lastLive: null,
        reason: 'orphan-folder',
        newestFile: new Date(newestActivityMs).toISOString(),
      });
    }

    console.log(`[StaleClips] Found ${stale.length} orphan stale folders out of ${streamerFolders.length} total (${protectedFolders} protected active folders)`);
    return NextResponse.json({ stale, protectedFolders, checkedFolders: streamerFolders.length, activeLogins: activeLogins.size });
  } catch (error) {
    console.error('[StaleClips] Error:', error);
    return NextResponse.json({ error: 'Failed to check' }, { status: 500 });
  }
}
