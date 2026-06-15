import { db } from '@/data/server-init';

export type DiscordActivitySummary = {
  messageCount: number;
  voiceMinutes: number;
  helpfulReactions: number;
  streamAttendance: number;
  activeDays: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastSeenChannelId: string | null;
  lastSeenChannelName: string | null;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
};

type RecordDiscordMessageActivityInput = {
  serverId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  channelId?: string;
  channelName?: string;
};

type StoredDiscordActivity = DiscordActivitySummary & {
  lastSeenDay?: string | null;
};

function normalizeNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getUserRef(serverId: string, userId: string) {
  return db.collection('servers').doc(serverId).collection('users').doc(userId);
}

function stripInternalFields(summary: StoredDiscordActivity): DiscordActivitySummary {
  return {
    messageCount: normalizeNumber(summary.messageCount),
    voiceMinutes: normalizeNumber(summary.voiceMinutes),
    helpfulReactions: normalizeNumber(summary.helpfulReactions),
    streamAttendance: normalizeNumber(summary.streamAttendance),
    activeDays: normalizeNumber(summary.activeDays),
    firstSeenAt: summary.firstSeenAt || null,
    lastSeenAt: summary.lastSeenAt || null,
    lastSeenChannelId: summary.lastSeenChannelId || null,
    lastSeenChannelName: summary.lastSeenChannelName || null,
    username: summary.username,
    displayName: summary.displayName,
    avatarUrl: summary.avatarUrl,
  };
}

export async function recordDiscordMessageActivity(input: RecordDiscordMessageActivityInput): Promise<DiscordActivitySummary> {
  const userRef = getUserRef(input.serverId, input.userId);
  const snapshot = await userRef.get();
  const data = snapshot.data() || {};
  const existing = (data.discordActivity || {}) as StoredDiscordActivity;
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const lastSeenDay = String(existing.lastSeenDay || existing.lastSeenAt || '').slice(0, 10);

  const summary: StoredDiscordActivity = {
    messageCount: normalizeNumber(existing.messageCount) + 1,
    voiceMinutes: normalizeNumber(existing.voiceMinutes),
    helpfulReactions: normalizeNumber(existing.helpfulReactions),
    streamAttendance: normalizeNumber(existing.streamAttendance),
    activeDays: normalizeNumber(existing.activeDays) + (lastSeenDay === today ? 0 : 1),
    firstSeenAt: existing.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    lastSeenDay: today,
    lastSeenChannelId: input.channelId || existing.lastSeenChannelId || null,
    lastSeenChannelName: input.channelName || existing.lastSeenChannelName || null,
    username: input.username || existing.username,
    displayName: input.displayName || existing.displayName,
    avatarUrl: input.avatarUrl || existing.avatarUrl,
  };

  await userRef.set({
    discordUserId: input.userId,
    username: input.username,
    avatarUrl: input.avatarUrl || data.avatarUrl || '',
    discordActivity: summary,
  }, { merge: true });

  return stripInternalFields(summary);
}

export async function getDiscordActivitySummary(serverId: string, userId: string): Promise<DiscordActivitySummary | null> {
  const snapshot = await getUserRef(serverId, userId).get();
  if (!snapshot.exists) return null;

  const data = snapshot.data() || {};
  const existing = data.discordActivity as StoredDiscordActivity | undefined;
  if (!existing) return null;
  return stripInternalFields(existing);
}
