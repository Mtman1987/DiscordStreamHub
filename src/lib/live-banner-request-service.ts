import { db } from '@/lib/db';
import {
  getClipWorkerUrl,
  getHardcodedAdminDiscordId,
  getHardcodedAdminTwitchId,
  getStoragePath,
} from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';
import {
  BANNER_VERSION,
  type BannerVariant,
  isStoredBannerCurrent,
  resolveBannerVariant,
} from '@/lib/banner-policy';

const BANNER_REQUEST_COOLDOWN_MS = 30 * 60 * 1000;

function normalizeTwitchLogin(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export type LiveBannerContext = {
  group?: string | null;
  discordUserId?: string | null;
  twitchUserId?: string | null;
};

export function getExpectedLiveBannerVariant(
  twitchLogin: string,
  context: LiveBannerContext = {},
): BannerVariant {
  return resolveBannerVariant({
    twitchLogin,
    group: context.group,
    discordUserId: context.discordUserId,
    twitchUserId: context.twitchUserId,
    adminDiscordUserId: getHardcodedAdminDiscordId(),
    adminTwitchUserId: getHardcodedAdminTwitchId(),
  });
}

export function hasCurrentLiveBanner(
  twitchLogin: string,
  context: LiveBannerContext = {},
): boolean {
  const variant = getExpectedLiveBannerVariant(twitchLogin, context);
  return isStoredBannerCurrent(getStoragePath(), twitchLogin, variant);
}

export async function requestLiveBannerFromWorker(
  twitchLogin: string,
  context: LiveBannerContext = {},
): Promise<boolean> {
  const normalizedLogin = normalizeTwitchLogin(twitchLogin);
  if (!normalizedLogin) return false;
  const variant = getExpectedLiveBannerVariant(normalizedLogin, context);
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
        bannerRequests: [{ username: normalizedLogin, variant }],
        skipCommander: true,
      }),
      cache: 'no-store',
    });

    const result = await response.json().catch(() => null) as {
      bannerVersion?: string;
      generatedCount?: number;
    } | null;
    if (!response.ok) {
      console.warn(`[BannerRequest] Worker rejected banner request for ${normalizedLogin}: ${response.status}`);
      return false;
    }
    if (result?.bannerVersion !== BANNER_VERSION || Number(result?.generatedCount || 0) < 1) {
      console.warn(`[BannerRequest] Worker did not confirm a current ${variant} banner for ${normalizedLogin}`);
      return false;
    }

    console.log(`[BannerRequest] Worker accepted ${variant} banner request for ${normalizedLogin}`);
    return true;
  } catch (error) {
    console.warn(`[BannerRequest] Worker call failed for ${normalizedLogin}:`, error);
    return false;
  }
}

export async function maybeRequestLiveBanner(serverId: string, discordUserId: string, twitchLogin: string): Promise<void> {
  const normalizedLogin = normalizeTwitchLogin(twitchLogin);
  if (!serverId || !discordUserId || !normalizedLogin) return;

  const userRef = db.collection('servers').doc(serverId).collection('users').doc(discordUserId);
  const userDoc = await userRef.get();
  const data = userDoc.exists ? (userDoc.data() || {}) : {};
  const context: LiveBannerContext = {
    group: typeof data.group === 'string' ? data.group : null,
    discordUserId,
    twitchUserId: typeof data.twitchId === 'string' ? data.twitchId : null,
  };
  if (hasCurrentLiveBanner(normalizedLogin, context)) return;

  const lastRequestedAt = Number(data.lastBannerRequestAt || 0) || 0;
  const now = Date.now();

  if (lastRequestedAt > 0 && (now - lastRequestedAt) < BANNER_REQUEST_COOLDOWN_MS) {
    return;
  }

  const accepted = await requestLiveBannerFromWorker(normalizedLogin, context);
  if (!accepted) {
    return;
  }

  await userRef.set({
    lastBannerRequestAt: now,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}
