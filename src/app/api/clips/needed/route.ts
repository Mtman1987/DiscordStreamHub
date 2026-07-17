import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getHardcodedGuildId, getStoragePath } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

const STORAGE_PATH = getStoragePath();
const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

function normalizeLogin(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function toTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object' && value && 'seconds' in (value as Record<string, unknown>)) {
    const seconds = Number((value as Record<string, unknown>).seconds || 0);
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  return 0;
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
      const twitchLogin = normalizeLogin(data.twitchLogin);
      if (!twitchLogin) continue;

      // Check if live (has active shoutout state)
      const stateDoc = await db.collection('servers').doc(serverId)
        .collection('users').doc(doc.id)
        .collection('shoutoutState').doc('current').get();
      const stateData = stateDoc.exists ? (stateDoc.data() || {}) : {};
      const isLive = Boolean(stateData?.isLive);

      // Count existing GIFs
      const streamerDir = join(STORAGE_PATH, twitchLogin);
      let existingGifs = 0;
      if (existsSync(streamerDir)) {
        const files = await readdir(streamerDir);
        existingGifs = files.filter(f => f.endsWith('.gif')).length;
      }

      const lastClipFetch = Number(data.lastClipFetch || 0) || null;
      const cooldownRemaining = lastClipFetch ? Math.max(0, COOLDOWN_MS - (now - lastClipFetch)) : 0;
      const streamStartedAtMs = toTimestampMs(stateData?.streamStartedAt);
      const newLiveSession = streamStartedAtMs > 0 && (!lastClipFetch || lastClipFetch < streamStartedAtMs);
      const shouldFetch = isLive && (
        newLiveSession ||
        (!lastClipFetch && existingGifs === 0)
      );

      // Only fetch clips once per live session, or when a live user has no GIFs yet.
      if (shouldFetch) {
        needed.push({
          discordUserId: doc.id,
          twitchLogin,
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
      const liveSessionStartedAtMs = toTimestampMs(data?.createdAt || data?.updatedAt);
      const newLiveSession = liveSessionStartedAtMs > 0 && (!lastClipFetch || lastClipFetch < liveSessionStartedAtMs);
      if (newLiveSession || (!lastClipFetch && existingGifs === 0)) {
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
