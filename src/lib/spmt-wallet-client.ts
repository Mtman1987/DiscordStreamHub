import { grandfatherDiscordIdentity } from './spmt-client';

const SPMT_BASE_URL = (process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const SPMT_API_KEY = String(process.env.SPMT_API_KEY || '').trim();

export type SpmtWallet = {
  spendableXp: number;
  currentXp: number;
  lifetimeXp: number;
  totalXp: number;
  rank: number;
  level: number;
};

function headers() {
  if (!SPMT_API_KEY) throw new Error('SPMT_API_KEY is not configured');
  return { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${SPMT_API_KEY}` };
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${SPMT_BASE_URL}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error || `SPMT wallet request failed (${response.status})`));
  return payload;
}

export async function resolveDiscordSpmtUser(input: {
  discordId: string;
  discordUsername: string;
  displayName?: string;
  avatarUrl?: string;
}) {
  const result = await grandfatherDiscordIdentity({ ...input, issueSession: false });
  if (!result?.user?.id) throw new Error('Unable to resolve the Discord user to an SPMT account');
  return result.user;
}

export async function getSpmtWallet(userId: string): Promise<SpmtWallet> {
  return post('/api/platform/xp/balance', { userId }) as Promise<SpmtWallet>;
}

export async function spendSpmtXp(input: {
  userId: string;
  amount: number;
  eventType: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  return post('/api/platform/xp/spend', { sourceApp: 'discord-stream-hub', ...input });
}

export async function settleSpmtGamble(input: {
  userId: string;
  wager: number;
  payout: number;
  eventType: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  return post('/api/platform/xp/gamble-settle', { sourceApp: 'discord-stream-hub', ...input });
}

export async function awardSpendableSpmtXp(input: {
  userId: string;
  amount: number;
  eventType: string;
  idempotencyKey: string;
  lifetimeEligible?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return post('/api/platform/xp', {
    sourceApp: 'discord-stream-hub',
    userId: input.userId,
    delta: input.amount,
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    metadata: { ...(input.metadata || {}), lifetimeEligible: input.lifetimeEligible !== false },
  });
}

export async function transferSpmtXp(input: {
  fromUserId: string;
  toUserId: string;
  amount: number;
  eventType: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  return post('/api/platform/xp/transfer', { sourceApp: 'discord-stream-hub', ...input });
}

export async function getSpmtXpLeaderboard(limit = 10) {
  return post('/api/platform/xp/leaderboard', { limit });
}
