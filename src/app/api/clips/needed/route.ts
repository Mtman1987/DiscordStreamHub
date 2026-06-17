import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getHardcodedGuildId, getStoragePath } from '@/lib/runtime-config';

const STORAGE_PATH = getStoragePath();
const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours
const WORKER_SECRET = process.env.CLIP_WORKER_SECRET || process.env.BOT_SECRET_KEY || '1234';

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
    const usersSnap = await db.collection('servers').doc(serverId).collection('users').get();
    const manualSnap = await db.collection('servers').doc(serverId).collection('manualDiscordShoutouts').get();
    const now = Date.now();
    const needed: Array<{
      discordUserId: string;
      twitchLogin: string;
      group: string;
      existingGifs: number;
      isLive: boolean;
      lastClipFetch: number | null;
      cooldownRemaining: number;
    }> = [];

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      if (!data.twitchLogin) continue;

      // Check if live (has active shoutout state)
      const stateDoc = await db.collection('servers').doc(serverId)
        .collection('users').doc(doc.id)
        .collection('shoutoutState').doc('current').get();
      const isLive = stateDoc.exists && stateDoc.data()?.isLive;

      // Count existing GIFs
      const streamerDir = join(STORAGE_PATH, data.twitchLogin);
      let existingGifs = 0;
      if (existsSync(streamerDir)) {
        const files = await readdir(streamerDir);
        existingGifs = files.filter(f => f.endsWith('.gif')).length;
      }

      const lastClipFetch = data.lastClipFetch || null;
      const cooldownRemaining = lastClipFetch ? Math.max(0, COOLDOWN_MS - (now - lastClipFetch)) : 0;

      // Only include if live AND off cooldown
      if (isLive && cooldownRemaining === 0) {
        needed.push({
          discordUserId: doc.id,
          twitchLogin: data.twitchLogin,
          group: data.group || 'Everyone Else',
          existingGifs,
          isLive,
          lastClipFetch,
          cooldownRemaining,
        });
      }
    }

    for (const doc of manualSnap.docs) {
      const data = doc.data();
      const twitchLogin = String(data?.twitchLogin || '').trim().toLowerCase();
      if (!twitchLogin || !data?.needsGif || !data?.trackWhileLive || !data?.isLive) continue;

      const streamerDir = join(STORAGE_PATH, twitchLogin);
      let existingGifs = 0;
      if (existsSync(streamerDir)) {
        const files = await readdir(streamerDir);
        existingGifs = files.filter(f => f.endsWith('.gif')).length;
      }
      if (existingGifs > 0) continue;

      const lastClipFetch = Number(data?.lastGifRequestAt || 0) || null;
      const cooldownRemaining = lastClipFetch ? Math.max(0, COOLDOWN_MS - (now - lastClipFetch)) : 0;

      if (cooldownRemaining === 0) {
        needed.push({
          discordUserId: `manual:${doc.id}`,
          twitchLogin,
          group: 'Manual',
          existingGifs,
          isLive: true,
          lastClipFetch,
          cooldownRemaining,
        });
      }
    }

    // Sort: manual requests first, then Crew/Partners, then by fewest existing GIFs.
    const priority = ['Manual', 'Crew', 'Partners', 'Honored Guests', 'Everyone Else'];
    needed.sort((a, b) => {
      const pa = priority.indexOf(a.group);
      const pb = priority.indexOf(b.group);
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return a.existingGifs - b.existingGifs;
    });

    return NextResponse.json({ needed, serverId });
  } catch (error) {
    console.error('[ClipsNeeded] Error:', error);
    return NextResponse.json({ error: 'Failed to check' }, { status: 500 });
  }
}
