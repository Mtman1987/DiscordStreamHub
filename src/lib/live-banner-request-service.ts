'use server';

import { db } from '@/lib/db';
import { getClipWorkerUrl, getStoragePath } from '@/lib/runtime-config';
import { existsSync } from 'fs';
import { join } from 'path';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

const BANNER_REQUEST_COOLDOWN_MS = 30 * 60 * 1000;

function normalizeTwitchLogin(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function hasStoredBanner(twitchLogin: string): boolean {
  const normalizedLogin = normalizeTwitchLogin(twitchLogin);
  if (!normalizedLogin) return false;
  return existsSync(join(getStoragePath(), 'banners', `${normalizedLogin}.gif`));
}

export async function requestLiveBannerFromWorker(twitchLogin: string): Promise<boolean> {
  const normalizedLogin = normalizeTwitchLogin(twitchLogin);
  if (!normalizedLogin) return false;
  const workerSecret = getClipWorkerSecret();
  if (!workerSecret) {
    console.warn('[BannerRequest] CLIP_WORKER_SECRET is not configured');
    return false;
  }

  try {
    const response = await fetch(`${getClipWorkerUrl().replace(/\/$/, '')}/api/banners/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workerSecret}`,
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
      return false;
    }

    console.log(`[BannerRequest] Worker accepted banner request for ${normalizedLogin}`);
    return true;
  } catch (error) {
    console.warn(`[BannerRequest] Worker call failed for ${normalizedLogin}:`, error);
    return false;
  }
}

export async function maybeRequestLiveBanner(serverId: string, discordUserId: string, twitchLogin: string): Promise<void> {
  const normalizedLogin = normalizeTwitchLogin(twitchLogin);
  if (!serverId || !discordUserId || !normalizedLogin) return;
  if (hasStoredBanner(normalizedLogin)) return;

  const userRef = db.collection('servers').doc(serverId).collection('users').doc(discordUserId);
  const userDoc = await userRef.get();
  const data = userDoc.exists ? (userDoc.data() || {}) : {};
  const lastRequestedAt = Number(data.lastBannerRequestAt || 0) || 0;
  const now = Date.now();

  if (lastRequestedAt > 0 && (now - lastRequestedAt) < BANNER_REQUEST_COOLDOWN_MS) {
    return;
  }

  const accepted = await requestLiveBannerFromWorker(normalizedLogin);
  if (!accepted) {
    return;
  }

  await userRef.set({
    lastBannerRequestAt: now,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}
