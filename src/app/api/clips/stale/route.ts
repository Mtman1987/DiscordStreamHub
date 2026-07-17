import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getHardcodedGuildId, getStoragePath } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

const STORAGE_PATH = getStoragePath();
const STALE_DAYS = 30;

// Folders that aren't streamer clips
const SKIP_FOLDERS = new Set([
  'admin-calendar',
  'admin-leaderboard',
  'banners',
  'calendar',
  'embeds',
  'leaderboard',
  'leaderboard-images',
  'twitch',
]);

function normalizeLogin(value: string): string {
  return String(value || '').trim().toLowerCase();
}

async function getNewestFolderActivityMs(folderName: string): Promise<number> {
  const folderPath = join(STORAGE_PATH, folderName);
  let newestMs = 0;

  try {
    const folderStat = await stat(folderPath);
    newestMs = Math.max(newestMs, folderStat.mtimeMs || 0);
  } catch {}

  try {
    const files = await readdir(folderPath, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      try {
        const fileStat = await stat(join(folderPath, file.name));
        newestMs = Math.max(newestMs, fileStat.mtimeMs || 0);
      } catch {}
    }
  } catch {}

  return newestMs;
}

export async function GET(request: NextRequest) {
  const workerSecret = getClipWorkerSecret();
  if (!workerSecret) {
    return NextResponse.json({ error: 'Clip worker credential is not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${workerSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serverId = request.nextUrl.searchParams.get('serverId') || getHardcodedGuildId() || '';
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
    const usersByLogin = new Map<string, any>(
      usersSnap.docs
        .map((doc: any) => [normalizeLogin(doc.data()?.twitchLogin || ''), doc] as const)
        .filter(([login]: readonly [string, any]) => Boolean(login))
    );

    const cutoff = Date.now() - (STALE_DAYS * 24 * 60 * 60 * 1000);
    const stale: Array<{ twitchLogin: string; lastLive: string | null; reason: string; newestFile: string | null }> = [];

    for (const folder of streamerFolders) {
      const login = folder.name;
      const normalizedLogin = normalizeLogin(login);
      const folderActivityMs = await getNewestFolderActivityMs(login);

      // Find user by twitchLogin
      const userDoc = usersByLogin.get(normalizedLogin) || null;

      if (!userDoc) {
        // No user record — only stale if the folder itself has been inactive for the full retention window.
        if (folderActivityMs > 0 && folderActivityMs < cutoff) {
          stale.push({
            twitchLogin: login,
            lastLive: new Date(folderActivityMs).toISOString(),
            reason: 'no-linked-user',
            newestFile: new Date(folderActivityMs).toISOString(),
          });
        }
        continue;
      }

      const userData = userDoc.data();

      // Check if they have an active shoutout (currently live)
      const stateDoc = await db.collection('servers').doc(serverId)
        .collection('users').doc(userDoc.id)
        .collection('shoutoutState').doc('current').get();

      if (stateDoc.exists && stateDoc.data()?.isLive) {
        continue; // Currently live, skip
      }

      // Use the most recent timestamp we can find:
      // lastClipFetch (set by clip worker), lastStatusUpdate (set by polling), or isOnline
      let lastActiveMs = 0;
      const candidates = [
        folderActivityMs,
        userData.lastClipFetch,
        userData.lastStatusUpdate,
        userData.lastUpdated,
        userData.linkedAt,
      ];
      for (const ts of candidates) {
        if (!ts) continue;
        let ms = 0;
        if (ts instanceof Date) ms = ts.getTime();
        else if (typeof ts === 'string') ms = new Date(ts).getTime();
        else if (typeof ts === 'number') ms = ts;
        if (ms > lastActiveMs) lastActiveMs = ms;
      }

      // If user is currently marked online, skip
      if (userData.isOnline === true) continue;

      // If we have no timestamps at all, don't delete — they might be new
      if (lastActiveMs === 0) continue;

      if (lastActiveMs < cutoff) {
        stale.push({
          twitchLogin: login,
          lastLive: new Date(lastActiveMs).toISOString(),
          reason: 'inactive-retention-expired',
          newestFile: folderActivityMs > 0 ? new Date(folderActivityMs).toISOString() : null,
        });
      }
    }

    console.log(`[StaleClips] Found ${stale.length} stale folders out of ${streamerFolders.length} total`);
    return NextResponse.json({ stale });
  } catch (error) {
    console.error('[StaleClips] Error:', error);
    return NextResponse.json({ error: 'Failed to check' }, { status: 500 });
  }
}
