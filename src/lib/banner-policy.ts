import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeGroupValue } from './group-utils.ts';

export const BANNER_VERSION = '2026-08-28-role-aware-1';
const COMMANDER_TWITCH_LOGINS = new Set(['mtman1987', 'spacemountainlive']);

export type BannerVariant = 'commander' | 'crew' | 'mountaineer';

export type BannerIdentity = {
  twitchLogin: string;
  group?: string | null;
  discordUserId?: string | null;
  twitchUserId?: string | null;
  adminDiscordUserId?: string | null;
  adminTwitchUserId?: string | null;
};

export const BANNER_VARIANTS: Record<BannerVariant, {
  labelHtml: string;
  message: string;
  primaryColor: string;
  secondaryColor: string;
  showUsername: boolean;
}> = {
  commander: {
    labelHtml: 'COMMANDER MT',
    message: 'THE MOUNTAIN IS LIVE &bull; ALL SYSTEMS GO',
    primaryColor: '#ffd24a',
    secondaryColor: '#fff0a6',
    showUsername: false,
  },
  crew: {
    labelHtml: 'SPACEMOUNTAIN CREW',
    message: 'CREW SIGNAL LOCKED &bull; LIVE NOW',
    primaryColor: '#00b7ff',
    secondaryColor: '#79dcff',
    showUsername: true,
  },
  mountaineer: {
    labelHtml: 'MOUNTAINEER <span class="heart">&hearts;</span>',
    message: 'SIGNAL RECEIVED &bull; LIVE NOW',
    primaryColor: '#39e58c',
    secondaryColor: '#a3f7c7',
    showUsername: true,
  },
};

function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeBannerVariant(value: unknown): BannerVariant {
  const candidate = normalized(value);
  if (candidate === 'commander' || candidate === 'crew') return candidate;
  return 'mountaineer';
}

export function resolveBannerVariant(identity: BannerIdentity): BannerVariant {
  const twitchLogin = normalized(identity.twitchLogin);
  const discordUserId = normalized(identity.discordUserId);
  const twitchUserId = normalized(identity.twitchUserId);
  const adminDiscordUserId = normalized(identity.adminDiscordUserId);
  const adminTwitchUserId = normalized(identity.adminTwitchUserId);

  const isCommander = COMMANDER_TWITCH_LOGINS.has(twitchLogin)
    || Boolean(discordUserId && adminDiscordUserId && discordUserId === adminDiscordUserId)
    || Boolean(twitchUserId && adminTwitchUserId && twitchUserId === adminTwitchUserId);

  if (isCommander) return 'commander';
  if (normalizeGroupValue(identity.group) === 'crew') return 'crew';
  return 'mountaineer';
}

export function bannerStorageKey(twitchLogin: string): string {
  return normalized(twitchLogin).replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

export function isStoredBannerCurrent(
  storagePath: string,
  twitchLogin: string,
  expectedVariant: BannerVariant,
): boolean {
  const bannerKey = bannerStorageKey(twitchLogin);
  if (!bannerKey) return false;

  const bannersDir = join(storagePath, 'banners');
  const bannerPath = join(bannersDir, `${bannerKey}.gif`);
  const metaPath = join(bannersDir, `${bannerKey}.gif.meta.json`);
  if (!existsSync(bannerPath) || !existsSync(metaPath)) return false;

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      version?: string;
      variant?: string;
    };
    return meta.version === BANNER_VERSION
      && normalizeBannerVariant(meta.variant) === expectedVariant;
  } catch {
    return false;
  }
}
