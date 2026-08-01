import { resolveSpmtUserForPoints } from '@/lib/points-service';
import { getSpmtXpWallet, type SpmtXpWallet } from '@/lib/spmt-client';

export type PointsWallet = {
  /** Spendable balance. Every purchase and wager comes out of this number. */
  points: number;
  currentPoints: number;
  /** Never decreases, so spending cannot drop a user down the leaderboard. */
  lifetimePoints: number;
  rank: number | null;
  source: 'spmt' | 'legacy';
};

/**
 * Resolves the canonical SPMT XP wallet for a Discord user. Returns null when
 * SPMT is unconfigured or the user has no linked identity, so callers can fall
 * back to the legacy per-server leaderboard.
 */
export async function resolveSpmtPointsWallet(input: {
  serverId: string;
  userId: string;
  source?: 'twitch' | 'discord' | 'manual';
  metadata?: Record<string, unknown>;
}): Promise<(PointsWallet & { spmtUserId: string; wallet: SpmtXpWallet }) | null> {
  const identity = await resolveSpmtUserForPoints({ source: 'discord', ...input }).catch(() => null);
  const spmtUserId = String(identity?.user?.id || '');
  if (!spmtUserId) return null;

  const wallet = await getSpmtXpWallet(spmtUserId);
  if (!wallet) return null;

  return {
    spmtUserId,
    wallet,
    points: wallet.spendableXp,
    currentPoints: wallet.spendableXp,
    lifetimePoints: wallet.lifetimeXp,
    rank: wallet.rank ?? null,
    source: 'spmt',
  };
}
