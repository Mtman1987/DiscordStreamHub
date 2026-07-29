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
        metadata: {
          serverId: input.serverId,
          localUserId: input.localUserId,
          sourceStore: 'dsh-leaderboard',
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
