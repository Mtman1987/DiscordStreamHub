import { db } from '@/data/server-init';
import { getServerBranding } from '@/lib/server-branding';

function asNumber(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

async function listServerIds(): Promise<string[]> {
  const snapshot = await db.collection('servers').get();
  return snapshot.docs.map((doc: { id: string }) => doc.id);
}

async function serverName(serverId: string): Promise<string> {
  const branding = await getServerBranding(serverId);
  return branding.serverName || serverId;
}

export type TenantPointsEntry = {
  tenantId: string;
  serverId: string;
  tenantName: string;
  currentPoints: number;
  lifetimePoints: number;
  rank: number | null;
};

export async function getTenantPointBalances(
  userId: string,
  currentServerId?: string,
): Promise<TenantPointsEntry[]> {
  const serverIds = await listServerIds();
  const entries = await Promise.all(serverIds.map(async (serverId) => {
    const leaderboard = db.collection('servers').doc(serverId).collection('leaderboard');
    const userDoc = await leaderboard.doc(userId).get();
    if (!userDoc.exists) return null;

    const data = userDoc.data() || {};
    const currentPoints = asNumber(data.currentPoints ?? data.points);
    const lifetimePoints = asNumber(data.lifetimePoints ?? data.points);
    const higher = await leaderboard.where('points', '>', currentPoints).get();

    return {
      tenantId: serverId,
      serverId,
      tenantName: await serverName(serverId),
      currentPoints,
      lifetimePoints,
      rank: higher.size + 1,
    } satisfies TenantPointsEntry;
  }));

  return entries
    .filter((entry): entry is TenantPointsEntry => Boolean(entry))
    .sort((left, right) => {
      if (left.serverId === currentServerId) return -1;
      if (right.serverId === currentServerId) return 1;
      return right.currentPoints - left.currentPoints;
    });
}

export type TenantActivityEntry = {
  tenantId: string;
  serverId: string;
  tenantName: string;
  watchMinutes: number;
  voiceMinutes: number;
  messageCount: number;
  activeDays: number;
};

export async function getTenantActivity(
  userId: string,
  currentServerId?: string,
): Promise<TenantActivityEntry[]> {
  const serverIds = await listServerIds();
  const entries = await Promise.all(serverIds.map(async (serverId) => {
    const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
    if (!userDoc.exists) return null;

    const data = userDoc.data() || {};
    const activity = data.discordActivity || {};
    const voiceMinutes = asNumber(activity.voiceMinutes);
    const watchMinutes = asNumber(activity.watchMinutes ?? voiceMinutes);
    const messageCount = asNumber(activity.messageCount);
    const activeDays = asNumber(activity.activeDays);
    if (watchMinutes <= 0 && messageCount <= 0 && activeDays <= 0) return null;

    return {
      tenantId: serverId,
      serverId,
      tenantName: await serverName(serverId),
      watchMinutes,
      voiceMinutes,
      messageCount,
      activeDays,
    } satisfies TenantActivityEntry;
  }));

  return entries
    .filter((entry): entry is TenantActivityEntry => Boolean(entry))
    .sort((left, right) => {
      if (left.serverId === currentServerId) return -1;
      if (right.serverId === currentServerId) return 1;
      return right.watchMinutes - left.watchMinutes;
    });
}
