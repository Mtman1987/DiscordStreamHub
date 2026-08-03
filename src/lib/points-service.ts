import { Timestamp, db } from '@/data/server-init';
import type { LeaderboardSettings } from '@/lib/types';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { awardSpmtXp, grandfatherDiscordIdentity, grandfatherTwitchIdentity } from '@/lib/spmt-client';
import { resolveTwitchPointsIdentity } from '@/lib/spmt-points-identity';
import { buildXpIdempotencyKey, mappedXpAwardV1, type XpMappedEventTypeV1 } from '@spmt/sdk';

export type PointsEventType =
  | 'raid'
  | 'follow'
  | 'subscription'
  | 'gifted_subscription'
  | 'bits'
  | 'chat_activity'
  | 'first_message'
  | 'message_reaction'
  | 'admin_calendar_event'
  | 'admin_captains_log'
  | 'admin_message';

export interface AwardPointsInput {
  serverId: string;
  userId: string;
  eventType: PointsEventType;
  quantity?: number;
  source?: 'twitch' | 'discord' | 'manual';
  metadata?: Record<string, unknown>;
}

export interface AwardPointsResult {
  pointsAwarded: number;
  settingsSnapshot: LeaderboardSettings;
}

const DEFAULT_SETTINGS: LeaderboardSettings = {
  raidPoints: 10,
  followPoints: 5,
  subPoints: 50,
  giftedSubPoints: 25,
  bitPoints: 1,
  chatActivityPoints: 1,
  firstMessagePoints: 5,
  messageReactionPoints: 1,
  adminEventPoints: 10,
  adminLogPoints: 5,
  adminMessagePoints: 1,
};

const EVENT_TO_SETTING_KEY: Record<
  PointsEventType,
  keyof LeaderboardSettings | null
> = {
  raid: 'raidPoints',
  follow: 'followPoints',
  subscription: 'subPoints',
  gifted_subscription: 'giftedSubPoints',
  bits: 'bitPoints',
  chat_activity: 'chatActivityPoints',
  first_message: 'firstMessagePoints',
  message_reaction: 'messageReactionPoints',
  admin_calendar_event: 'adminEventPoints',
  admin_captains_log: 'adminLogPoints',
  admin_message: 'adminMessagePoints',
};

const DSH_XP_EVENT_MAP: Partial<Record<PointsEventType, XpMappedEventTypeV1>> = {
  chat_activity: 'dsh.discord.message',
  follow: 'dsh.twitch.follow',
  raid: 'dsh.twitch.raid',
  subscription: 'dsh.twitch.sub',
  gifted_subscription: 'dsh.twitch.sub',
};

function calculatePointsFromSettings(
  eventType: PointsEventType,
  quantity: number,
  settings: LeaderboardSettings,
): number {
  const mappedSetting = EVENT_TO_SETTING_KEY[eventType];
  if (!mappedSetting) {
    return 0;
  }

  const baseValue = settings[mappedSetting] ?? DEFAULT_SETTINGS[mappedSetting];

  switch (eventType) {
    case 'bits': {
      // quantity is the number of bits. Award per 100 bits.
      const hundredBlocks = Math.floor(quantity / 100);
      return hundredBlocks * baseValue;
    }
    case 'gifted_subscription': {
      return quantity * baseValue;
    }
    case 'chat_activity':
    case 'first_message':
    case 'message_reaction':
    case 'raid':
    case 'follow':
    case 'subscription':
    case 'admin_calendar_event':
    case 'admin_captains_log':
    case 'admin_message':
    default:
      return quantity * baseValue;
  }
}

async function fetchLeaderboardSettings(
  serverId: string,
): Promise<LeaderboardSettings> {
  const settingsRef = db
    .collection('servers')
    .doc(serverId)
    .collection('config')
    .doc('leaderboardSettings');

  const snapshot = await settingsRef.get();
  if (!snapshot.exists) {
    return DEFAULT_SETTINGS;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(snapshot.data() as Partial<LeaderboardSettings>),
  };
}

export async function resolveSpmtUserForPoints(input: {
  serverId: string;
  userId: string;
  source?: 'twitch' | 'discord' | 'manual';
  metadata?: Record<string, unknown>;
}) {
  const metadata = input.metadata || {};
  const username = String(metadata.username || metadata.displayName || input.userId).trim();
  const displayName = String(metadata.displayName || metadata.username || username).trim();

  if (input.source === 'discord') {
    return grandfatherDiscordIdentity({
      discordId: input.userId,
      discordUsername: username || input.userId,
      displayName: displayName || username || input.userId,
      avatarUrl: typeof metadata.avatarUrl === 'string' ? metadata.avatarUrl : undefined,
      issueSession: false,
    });
  }

  if (input.source === 'twitch') {
    const linkedUserDoc = await db.collection('servers').doc(input.serverId).collection('users').doc(input.userId).get().catch(() => null);
    const linked = linkedUserDoc?.exists ? linkedUserDoc.data() || {} : {};
    const identity = resolveTwitchPointsIdentity({
      sourceUserId: input.userId,
      fallbackUsername: username,
      metadata,
      linkedUser: linked,
      linkedUserExists: Boolean(linkedUserDoc?.exists),
    });

    if (identity?.provider === 'twitch') {
      return grandfatherTwitchIdentity({
        twitchId: identity.providerUserId,
        twitchUsername: identity.providerUsername,
        displayName: displayName || identity.providerUsername,
        issueSession: false,
      });
    }

    if (identity?.provider === 'discord') {
      return grandfatherDiscordIdentity({
        discordId: identity.providerUserId,
        discordUsername: identity.providerUsername,
        displayName: displayName || username || input.userId,
        issueSession: false,
      });
    }
  }

  return null;
}

async function awardCanonicalDshXp(input: {
  serverId: string;
  userId: string;
  eventType: PointsEventType;
  pointsAwarded: number;
  source?: 'twitch' | 'discord' | 'manual';
  metadata?: Record<string, unknown>;
  eventLogId: string;
}) {
  try {
    const isTwitchMessage = input.eventType === 'chat_activity' && input.source === 'twitch';
    const isTwitchBits = input.eventType === 'bits' && input.source === 'twitch';
    const mappedEventType = DSH_XP_EVENT_MAP[input.eventType];
    if ((!mappedEventType && !isTwitchMessage && !isTwitchBits) || input.pointsAwarded <= 0 || input.source === 'manual') return;

    const identity = await resolveSpmtUserForPoints(input);
    const spmtUserId = identity?.user?.id;
    if (!spmtUserId) return;

    const metadata = {
      serverId: input.serverId,
      localUserId: input.userId,
      source: input.source || 'unknown',
      pointsEventType: input.eventType,
      ...(input.metadata || {}),
    };
    const customTwitchEventType = isTwitchMessage
      ? 'dsh-twitch-message'
      : isTwitchBits
      ? 'dsh-twitch-bits'
      : null;
    const award = customTwitchEventType
      ? {
          userId: spmtUserId,
          sourceApp: 'discord-stream-hub',
          eventType: customTwitchEventType,
          idempotencyKey: buildXpIdempotencyKey({
            sourceApp: 'discord-stream-hub',
            eventType: customTwitchEventType,
            upstreamEventId: input.eventLogId,
            userId: spmtUserId,
          }),
          delta: input.pointsAwarded,
          metadata: { schemaVersion: 1 as const, upstreamEventId: input.eventLogId, ...metadata },
        }
      : mappedXpAwardV1({
          userId: spmtUserId,
          mappedEventType: mappedEventType!,
          upstreamEventId: input.eventLogId,
          deltaOverride: input.pointsAwarded,
          metadata,
        });
    await awardSpmtXp(award);
  } catch (error) {
    console.warn('[DSH] SPMT XP award skipped', error);
  }
}

export async function awardPoints({
  serverId,
  userId,
  eventType,
  quantity = 1,
  source,
  metadata,
}: AwardPointsInput): Promise<AwardPointsResult> {
  const settings = await fetchLeaderboardSettings(serverId);
  const pointsToAward = calculatePointsFromSettings(
    eventType,
    quantity,
    settings,
  );

  if (pointsToAward === 0) {
    return {
      pointsAwarded: 0,
      settingsSnapshot: settings,
    };
  }

  const isAdminEvent = eventType === 'admin_calendar_event' || eventType === 'admin_captains_log' || eventType === 'admin_message';
  const collectionName = isAdminEvent ? 'adminLeaderboard' : 'leaderboard';

  const leaderboardRef = db
    .collection('servers')
    .doc(serverId)
    .collection(collectionName)
    .doc(userId);

  const currentDoc = await leaderboardRef.get();
  const currentPoints = (currentDoc.exists ? currentDoc.data()?.points : 0) || 0;
  const newPoints = typeof currentPoints === 'number' ? currentPoints + pointsToAward : pointsToAward;

  const payload = {
    userProfileId: userId,
    points: newPoints,
    lastUpdated: new Date().toISOString(),
    lastEventType: eventType,
    lastEventSource: source ?? 'unknown',
    lastEventMetadata: metadata ?? null,
  };

  await leaderboardRef.set(payload, { merge: true });

  const logRef = db
    .collection('servers')
    .doc(serverId)
    .collection(isAdminEvent ? 'adminLeaderboardEvents' : 'leaderboardEvents')
    .doc();

  await logRef.set({
    ...payload,
    pointsAwarded: pointsToAward,
    createdAt: Timestamp.now(),
  });

  void awardCanonicalDshXp({
    serverId,
    userId,
    eventType,
    pointsAwarded: pointsToAward,
    source,
    metadata,
    eventLogId: logRef.id,
  });

  return {
    pointsAwarded: pointsToAward,
    settingsSnapshot: settings,
  };
}

export class PointsService {
  private static instance: PointsService;
  
  static getInstance(): PointsService {
    if (!PointsService.instance) {
      PointsService.instance = new PointsService();
    }
    return PointsService.instance;
  }

  async addPoints(userId: string, username: string, displayName: string, points: number, serverId?: string): Promise<{ points: number }> {
    const actualServerId = serverId || getHardcodedGuildId() || 'default';

    const leaderboardRef = db.collection('servers').doc(actualServerId).collection('leaderboard').doc(userId);
    const currentDoc = await leaderboardRef.get();
    const currentPoints = (currentDoc.exists ? currentDoc.data()?.points : 0) || 0;
    const newPoints = currentPoints + points;

    await leaderboardRef.set({
      userProfileId: userId,
      points: newPoints,
      lastUpdated: new Date().toISOString(),
      lastEventType: 'admin_message',
      lastEventSource: 'manual',
      lastEventMetadata: { username, displayName },
    }, { merge: true });

    return { points: newPoints };
  }

  async setPoints(userId: string, username: string, displayName: string, points: number, serverId?: string): Promise<{ points: number }> {
    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const leaderboardRef = db.collection('servers').doc(actualServerId).collection('leaderboard').doc(userId);
    const clampedPoints = Math.max(0, Math.trunc(Number(points || 0)));

    await leaderboardRef.set({
      userProfileId: userId,
      points: clampedPoints,
      lastUpdated: new Date().toISOString(),
      lastEventType: 'admin_message',
      lastEventSource: 'manual',
      lastEventMetadata: { username, displayName },
    }, { merge: true });

    return { points: clampedPoints };
  }

  async getUserRank(userId: string, serverId?: string): Promise<{ rank: number; points: number } | null> {
    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const userRef = db.collection('servers').doc(actualServerId).collection('leaderboard').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return null;
    }

    const userPoints = Number(userDoc.data()?.points || 0);
    const leaderboardSnapshot = await db
      .collection('servers')
      .doc(actualServerId)
      .collection('leaderboard')
      .orderBy('points', 'desc')
      .get();

    const rank = leaderboardSnapshot.docs.findIndex((doc: { id: string }) => doc.id === userId) + 1;
    return { rank: rank > 0 ? rank : leaderboardSnapshot.docs.length + 1, points: userPoints };
  }

  async getUserPoints(userId: string, serverId?: string): Promise<{ username?: string; displayName?: string; points: number } | null> {
    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const userRef = db.collection('servers').doc(actualServerId).collection('leaderboard').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return null;
    }

    const data = userDoc.data() || {};
    return {
      username: data.lastEventMetadata?.username as string | undefined,
      displayName: data.lastEventMetadata?.displayName as string | undefined,
      points: Number(data.points || 0),
    };
  }

  async getLeaderboard(limit: number = 50, serverId?: string): Promise<any[]> {
    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    
    const leaderboardRef = db
      .collection('servers')
      .doc(actualServerId)
      .collection('leaderboard')
      .orderBy('points', 'desc')
      .limit(limit);

    const snapshot = await leaderboardRef.get();
    return snapshot.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }));
  }

  async addPointsToAll(points: number, serverId?: string): Promise<{ count: number }> {
    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const delta = Math.trunc(Number(points || 0));
    if (!delta) return { count: 0 };

    const snapshot = await db
      .collection('servers')
      .doc(actualServerId)
      .collection('leaderboard')
      .get();

    let count = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const currentPoints = Number(data.points || 0);
      const nextPoints = Math.max(0, currentPoints + delta);
      await doc.ref.set({
        points: nextPoints,
        lastUpdated: new Date().toISOString(),
        lastEventType: 'admin_message',
        lastEventSource: 'manual',
      }, { merge: true });
      count += 1;
    }

    return { count };
  }

  async setPointsToAll(points: number, serverId?: string): Promise<{ count: number }> {
    const actualServerId = serverId || getHardcodedGuildId() || 'default';
    const normalizedPoints = Math.max(0, Math.trunc(Number(points || 0)));
    const snapshot = await db
      .collection('servers')
      .doc(actualServerId)
      .collection('leaderboard')
      .get();

    let count = 0;
    for (const doc of snapshot.docs) {
      await doc.ref.set({
        points: normalizedPoints,
        lastUpdated: new Date().toISOString(),
        lastEventType: 'admin_message',
        lastEventSource: 'manual',
      }, { merge: true });
      count += 1;
    }

    return { count };
  }
}
