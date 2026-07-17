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
