const SPMT_BASE_URL = process.env.SPMT_BASE_URL || 'https://spmt.live';
const SPMT_API_KEY = process.env.SPMT_API_KEY || '';

export type SpmtEventVisibility = 'private' | 'creator' | 'community' | 'public' | 'system';

export type SpmtEventInput = {
  type: string;
  sourceApp?: string;
  visibility?: SpmtEventVisibility;
  actor?: {
    userId?: string;
    username?: string;
    displayName?: string;
  };
  payload?: Record<string, unknown>;
  links?: Array<{
    label: string;
    url: string;
    kind: 'launch' | 'details' | 'manage' | 'external';
  }>;
};

export function isSpmtEnabled() {
  return Boolean(SPMT_API_KEY);
}

export async function grandfatherDiscordIdentity(input: {
  discordId: string;
  discordUsername: string;
  displayName?: string;
  avatarUrl?: string;
  issueSession?: boolean;
}) {
  if (!SPMT_API_KEY) return null;
  try {
    const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/identity/grandfather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SPMT_API_KEY}` },
      body: JSON.stringify({
        provider: 'discord',
        providerUserId: input.discordId,
        providerUsername: input.discordUsername,
        username: input.discordUsername,
        displayName: input.displayName || input.discordUsername,
        avatarUrl: input.avatarUrl || undefined,
        issueSession: input.issueSession === true,
      }),
    });
    if (!response.ok) {
      console.warn('[SPMT] Discord identity grandfather failed', { status: response.status });
      return null;
    }
    return await response.json() as { user: { id: string; username: string }; accessToken?: string; created?: boolean };
  } catch (error) {
    console.warn('[SPMT] Discord identity grandfather error', error);
    return null;
  }
}

export async function claimDiscordSignalEgg(input: {
  discordUserId: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
}) {
  const { getSpmtServiceToken } = await import('./spmt-service-token');
  const token = await getSpmtServiceToken(['entitlements:write']);
  const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/internal/easter-eggs/signal/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(payload?.error || `SPMT Signal claim failed (${response.status})`));
  return payload as { ok: true; claimed: boolean; alreadyClaimed: boolean; userId: string; username: string };
}

export async function grandfatherTwitchIdentity(input: {
  twitchId: string;
  twitchUsername: string;
  displayName?: string;
  issueSession?: boolean;
}) {
  if (!SPMT_API_KEY) return null;
  try {
    const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/identity/grandfather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SPMT_API_KEY}` },
      body: JSON.stringify({
        provider: 'twitch',
        providerUserId: input.twitchId,
        providerUsername: input.twitchUsername,
        username: input.twitchUsername,
        displayName: input.displayName || input.twitchUsername,
        issueSession: input.issueSession === true,
      }),
    });
    if (!response.ok) {
      console.warn('[SPMT] Twitch identity grandfather failed', { status: response.status });
      return null;
    }
    return await response.json() as { user: { id: string; username: string }; accessToken?: string; created?: boolean };
  } catch (error) {
    console.warn('[SPMT] Twitch identity grandfather error', error);
    return null;
  }
}

export class SpmtIdentityOnboardingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'SpmtIdentityOnboardingError';
  }
}

export async function onboardVerifiedSpmtIdentity(input: {
  discord: {
    providerUserId: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
  };
  twitch: {
    providerUserId: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
  };
}) {
  if (!SPMT_API_KEY) {
    throw new SpmtIdentityOnboardingError('SPMT onboarding is temporarily unavailable.', 503, 'spmt_not_configured');
  }

  let response: Response;
  try {
    response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/identity/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SPMT_API_KEY}` },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined,
    });
  } catch {
    throw new SpmtIdentityOnboardingError('SPMT onboarding is temporarily unavailable. Please try again.', 503, 'spmt_unavailable');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SpmtIdentityOnboardingError(
      String(payload?.error || 'SPMT could not complete identity onboarding.'),
      response.status,
      String(payload?.code || 'spmt_onboarding_failed'),
    );
  }
  if (!payload?.user?.id || !payload?.continueUrl) {
    throw new SpmtIdentityOnboardingError('SPMT returned an incomplete onboarding response.', 502, 'invalid_spmt_response');
  }
  return payload as {
    created: boolean;
    purpose: 'claim' | 'recover';
    expiresAt: string;
    continueUrl: string;
    user: {
      id: string;
      username: string;
      credentialState?: 'provider-owned' | 'password-set';
    };
  };
}

export async function publishSpmtEvent(event: SpmtEventInput) {
  if (!SPMT_API_KEY) return { skipped: true, reason: 'SPMT_API_KEY not configured' };

  try {
    const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SPMT_API_KEY}`,
      },
      body: JSON.stringify({
        sourceApp: 'discord-stream-hub',
        visibility: 'creator',
        payload: {},
        ...event,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn('[SPMT] event publish failed', { status: response.status, body });
      return { skipped: false, ok: false, status: response.status };
    }

    return { skipped: false, ok: true };
  } catch (error) {
    console.warn('[SPMT] event publish error', error);
    return { skipped: false, ok: false };
  }
}

export type SpmtXpAwardInput = {
  userId: string;
  eventType: string;
  idempotencyKey: string;
  delta: number;
  sourceApp?: string;
  metadata?: Record<string, unknown>;
};

export async function awardSpmtXp(input: SpmtXpAwardInput) {
  if (!SPMT_API_KEY) return { skipped: true, reason: 'SPMT_API_KEY not configured' };

  try {
    const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/xp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SPMT_API_KEY}`,
      },
      body: JSON.stringify({
        sourceApp: 'discord-stream-hub',
        ...input,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[SPMT] XP award failed status=${response.status} body=${body.slice(0, 500)}`);
      return { skipped: false, ok: false, status: response.status };
    }

    return { skipped: false, ok: true, result: await response.json().catch(() => null) };
  } catch (error) {
    console.warn('[SPMT] XP award error', error);
    return { skipped: false, ok: false };
  }
}

export type SpmtXpWallet = {
  /** XP the user can spend. Purchases and wagers come out of this wallet only. */
  spendableXp: number;
  /** Everything the user has ever earned. Ranks are computed from this wallet. */
  lifetimeXp: number;
  rank: number;
  level: number;
};

async function platformXpRequest<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  if (!SPMT_API_KEY) return null;
  try {
    const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/xp${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SPMT_API_KEY}` },
      body: JSON.stringify({ sourceApp: 'discord-stream-hub', ...body }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn(`[SPMT] XP ${path} failed`, { status: response.status, error: payload?.error });
      return null;
    }
    return payload as T;
  } catch (error) {
    console.warn(`[SPMT] XP ${path} error`, error);
    return null;
  }
}

export async function getSpmtXpWallet(userId: string): Promise<SpmtXpWallet | null> {
  const wallet = await platformXpRequest<SpmtXpWallet>('/balance', { userId });
  return wallet && Number.isFinite(wallet.lifetimeXp) ? wallet : null;
}

export async function getSpmtXpLeaderboard(limit = 50): Promise<Array<{
  rank: number;
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  spendableXp: number;
  lifetimeXp: number;
}>> {
  const payload = await platformXpRequest<{ entries?: unknown }>('/leaderboard', { limit });
  return Array.isArray(payload?.entries) ? payload.entries as never : [];
}

/**
 * Settles a wager atomically: winnings refill spendable XP up to the lifetime
 * ceiling, and anything above it is compressed 10:1 and split evenly between
 * both wallets so a jackpot cannot bloat the leaderboard.
 */
export async function settleSpmtGamble(input: {
  userId: string;
  wager: number;
  payout: number;
  idempotencyKey: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
}): Promise<(SpmtXpWallet & { settled: boolean; duplicate: boolean; refill: number; matchedGrowth: number }) | null> {
  return platformXpRequest('/gamble-settle', input);
}

export async function spendSpmtXp(input: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
}): Promise<(SpmtXpWallet & { spent: boolean; duplicate: boolean }) | null> {
  return platformXpRequest('/spend', input);
}

export async function migrateSpmtXpBalance(input: {
  userId: string;
  observedBalance: number;
  serverId: string;
  localUserId: string;
}) {
  if (!SPMT_API_KEY) return { skipped: true, reason: 'SPMT_API_KEY not configured' };
  try {
    const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/xp/migrate-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SPMT_API_KEY}`,
      },
      body: JSON.stringify({
        sourceApp: 'discord-stream-hub',
        userId: input.userId,
        observedBalance: input.observedBalance,
        migrationVersion: 2,
        metadata: {
          serverId: input.serverId,
          localUserId: input.localUserId,
          sourceStore: 'dsh-leaderboard-events',
        },
      }),
      cache: 'no-store',
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn('[SPMT] Legacy XP balance migration failed', { status: response.status, error: result?.error });
      return { skipped: false, ok: false, status: response.status, result };
    }
    return { skipped: false, ok: true, result };
  } catch (error) {
    console.warn('[SPMT] Legacy XP balance migration error', error);
    return { skipped: false, ok: false };
  }
}
