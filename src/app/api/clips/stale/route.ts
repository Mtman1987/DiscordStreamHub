import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { getHardcodedGuildId, getStoragePath } from '@/lib/runtime-config';

const STORAGE_PATH = getStoragePath();
const STALE_DAYS = 30;
const WORKER_SECRET = process.env.CLIP_WORKER_SECRET || process.env.BOT_SECRET_KEY || '1234';

// Folders that aren't streamer clips
const SKIP_FOLDERS = new Set(['banners', 'leaderboard', 'admin-calendar', 'admin-leaderboard', 'twitch', 'calendar']);

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${WORKER_SECRET}`) {
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

    const cutoff = Date.now() - (STALE_DAYS * 24 * 60 * 60 * 1000);
    const stale: Array<{ twitchLogin: string; lastLive: string | null }> = [];

    for (const folder of streamerFolders) {
      const login = folder.name;

      // Find user by twitchLogin
      const userSnap = await db.collection('servers').doc(serverId)
        .collection('users')
        .where('twitchLogin', '==', login)
        .limit(1)
        .get();

      if (userSnap.empty) {
        // No user record at all — stale
        stale.push({ twitchLogin: login, lastLive: null });
        continue;
      }

      const userData = userSnap.docs[0].data();

      // Check if they have an active shoutout (currently live)
      const stateDoc = await db.collection('servers').doc(serverId)
        .collection('users').doc(userSnap.docs[0].id)
        .collection('shoutoutState').doc('current').get();

      if (stateDoc.exists && stateDoc.data()?.isLive) {
        continue; // Currently live, skip
      }

      // Use the most recent timestamp we can find:
      // lastClipFetch (set by clip worker), lastStatusUpdate (set by polling), or isOnline
      let lastActiveMs = 0;
      const candidates = [
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
