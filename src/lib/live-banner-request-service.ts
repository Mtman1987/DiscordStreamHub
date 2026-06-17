'use server';

import { db } from '@/lib/db';
import { getClipWorkerUrl } from '@/lib/runtime-config';

const WORKER_SECRET = process.env.CLIP_WORKER_SECRET || process.env.BOT_SECRET_KEY || '1234';
const BANNER_REQUEST_COOLDOWN_MS = 30 * 60 * 1000;

function normalizeTwitchLogin(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export async function maybeRequestLiveBanner(serverId: string, discordUserId: string, twitchLogin: string): Promise<void> {
  const normalizedLogin = normalizeTwitchLogin(twitchLogin);
  if (!serverId || !discordUserId || !normalizedLogin) return;

  const userRef = db.collection('servers').doc(serverId).collection('users').doc(discordUserId);
  const userDoc = await userRef.get();
  const data = userDoc.exists ? (userDoc.data() || {}) : {};
  const lastRequestedAt = Number(data.lastBannerRequestAt || 0) || 0;
  const now = Date.now();

  if (lastRequestedAt > 0 && (now - lastRequestedAt) < BANNER_REQUEST_COOLDOWN_MS) {
    return;
  }

  await userRef.set({
    lastBannerRequestAt: now,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  try {
    const response = await fetch(`${getClipWorkerUrl().replace(/\/$/, '')}/api/banners/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WORKER_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        crewMembers: [normalizedLogin],
        skipCommander: true,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn(`[BannerRequest] Worker rejected banner request for ${normalizedLogin}: ${response.status}`);
    }
  } catch (error) {
    console.warn(`[BannerRequest] Worker call failed for ${normalizedLogin}:`, error);
  }
}
