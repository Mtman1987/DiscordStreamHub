import { db } from '@/data/server-init';

const REPAIR_VERSION = 2;
const REPAIR_MARKER_ID = 'leaderboardIdentityRepairV2';

export type LeaderboardIdentityRepairSummary = {
  version: number;
  serverId: string;
  scannedUsers: number;
  scannedLeaderboardRows: number;
  migratedUsers: number;
  deletedAliasRows: number;
  conflicts: Array<{ aliasId: string; ownerIds: string[] }>;
  repairs: Array<{
    canonicalUserId: string;
    aliasIds: string[];
    consolidatedPoints: number;
  }>;
  completedAt: string;
  skipped?: boolean;
};

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function identityAliases(doc: { id: string; data: () => Record<string, unknown> }) {
  const user = doc.data() || {};
  return Array.from(new Set([
    text(doc.id),
    text(user.discordUserId),
    text(user.twitchId),
    text(user.twitchUserId),
  ].filter(Boolean)));
}

function latestEntry(entries: Array<{ id: string; data: Record<string, any> }>) {
  return [...entries].sort((a, b) => {
    const aTime = Date.parse(text(a.data.lastUpdated)) || 0;
    const bTime = Date.parse(text(b.data.lastUpdated)) || 0;
    return bTime - aTime;
  })[0];
}

/**
 * Consolidates legacy per-provider leaderboard rows onto the DSH user document
 * key. DSH user documents are keyed by Discord user ID and hold the verified
 * Twitch ID after linking, so provider aliases can be reconciled without ever
 * matching on a mutable username/display name.
 *
 * This is intentionally idempotent. A versioned marker makes the normal
 * startup/read path cheap after the migration has completed; the authenticated
 * maintenance endpoint can force a rescan when needed.
 */
export async function repairLegacyLeaderboardIdentityAliases(
  serverId: string,
  options: { force?: boolean } = {},
): Promise<LeaderboardIdentityRepairSummary> {
  const normalizedServerId = text(serverId);
  if (!normalizedServerId) throw new Error('serverId is required');

  const serverRef = db.collection('servers').doc(normalizedServerId);
  const markerRef = serverRef.collection('config').doc(REPAIR_MARKER_ID);

  if (!options.force) {
    const marker = await markerRef.get();
    if (marker.exists) {
      const data = marker.data() || {};
      return {
        version: REPAIR_VERSION,
        serverId: normalizedServerId,
        scannedUsers: Number(data.scannedUsers || 0),
        scannedLeaderboardRows: Number(data.scannedLeaderboardRows || 0),
        migratedUsers: Number(data.migratedUsers || 0),
        deletedAliasRows: Number(data.deletedAliasRows || 0),
        conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
        repairs: Array.isArray(data.repairs) ? data.repairs : [],
        completedAt: text(data.completedAt) || new Date().toISOString(),
        skipped: true,
      };
    }
  }

  const [usersSnapshot, leaderboardSnapshot] = await Promise.all([
    serverRef.collection('users').get(),
    serverRef.collection('leaderboard').get(),
  ]);

  const aliasOwners = new Map<string, Set<string>>();
  for (const userDoc of usersSnapshot.docs) {
    for (const aliasId of identityAliases(userDoc as any)) {
      const owners = aliasOwners.get(aliasId) || new Set<string>();
      owners.add(String(userDoc.id));
      aliasOwners.set(aliasId, owners);
    }
  }

  const conflicts = Array.from(aliasOwners.entries())
    .filter(([, owners]) => owners.size > 1)
    .map(([aliasId, owners]) => ({
      aliasId,
      ownerIds: Array.from(owners).sort(),
    }));

  const conflictedAliases = new Set(conflicts.map((entry) => entry.aliasId));
  const existingLeaderboardIds = new Set(leaderboardSnapshot.docs.map((doc: any) => String(doc.id)));
  const repairs: LeaderboardIdentityRepairSummary['repairs'] = [];
  let migratedUsers = 0;
  let deletedAliasRows = 0;

  for (const userDoc of usersSnapshot.docs) {
    const canonicalUserId = String(userDoc.id);
    const aliases = identityAliases(userDoc as any);
    if (aliases.some((aliasId) => conflictedAliases.has(aliasId))) continue;

    const existingAliasIds = aliases.filter((aliasId) => existingLeaderboardIds.has(aliasId));
    if (!existingAliasIds.some((aliasId) => aliasId !== canonicalUserId)) continue;

    const refs = aliases.map((aliasId) => serverRef.collection('leaderboard').doc(aliasId));
    const canonicalRef = serverRef.collection('leaderboard').doc(canonicalUserId);

    const result = await db.runTransaction(async (transaction: any) => {
      const snapshots = [];
      for (const ref of refs) snapshots.push(await transaction.get(ref));

      const entries = snapshots
        .filter((snapshot: any) => snapshot.exists)
        .map((snapshot: any) => ({
          id: String(snapshot.id),
          data: snapshot.data() || {},
          ref: snapshot.ref,
        }));

      if (!entries.some((entry: any) => entry.id !== canonicalUserId)) {
        return null;
      }

      const consolidatedPoints = entries.reduce(
        (total: number, entry: any) => total + Number(entry.data.points || 0),
        0,
      );
      const latest = latestEntry(entries as any);
      const now = new Date().toISOString();

      transaction.set(canonicalRef, {
        ...(latest?.data || {}),
        userProfileId: canonicalUserId,
        points: consolidatedPoints,
        lastUpdated: latest?.data?.lastUpdated || now,
        legacyIdentityRepair: {
          version: REPAIR_VERSION,
          repairedAt: now,
          aliases: entries.map((entry: any) => entry.id),
        },
      }, { merge: true });

      let deleted = 0;
      for (const entry of entries) {
        if (entry.id === canonicalUserId) continue;
        transaction.delete(entry.ref);
        deleted += 1;
      }

      return {
        aliasIds: entries.map((entry: any) => entry.id).filter((id: string) => id !== canonicalUserId),
        consolidatedPoints,
        deleted,
      };
    });

    if (!result) continue;
    migratedUsers += 1;
    deletedAliasRows += result.deleted;
    repairs.push({
      canonicalUserId,
      aliasIds: result.aliasIds,
      consolidatedPoints: result.consolidatedPoints,
    });
  }

  const summary: LeaderboardIdentityRepairSummary = {
    version: REPAIR_VERSION,
    serverId: normalizedServerId,
    scannedUsers: usersSnapshot.size,
    scannedLeaderboardRows: leaderboardSnapshot.size,
    migratedUsers,
    deletedAliasRows,
    conflicts,
    repairs,
    completedAt: new Date().toISOString(),
  };

  await markerRef.set(summary, { merge: false });
  if (migratedUsers || conflicts.length) {
    console.warn('[DSH] Legacy leaderboard identity repair completed', summary);
  }
  return summary;
}
