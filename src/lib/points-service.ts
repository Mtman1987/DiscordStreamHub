import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '@/firebase/server-init';
import type { LeaderboardSettings } from '@/lib/types';

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

  const payload = {
    userProfileId: userId,
    points: FieldValue.increment(pointsToAward),
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

  async addPoints(userId: string, username: string, displayName: string, points: number): Promise<void> {
    // For now, we'll use a default server ID. In a real implementation, this should be passed as a parameter
    const serverId = process.env.HARDCODED_GUILD_ID || 'default';
    
    await awardPoints({
      serverId,
      userId,
      eventType: 'admin_message', // Default event type for manual point additions
      quantity: points,
      source: 'manual',
      metadata: { username, displayName }
    });
  }

  async getLeaderboard(limit: number = 50, serverId?: string): Promise<any[]> {
    const actualServerId = serverId || process.env.HARDCODED_GUILD_ID || 'default';
    
    const leaderboardRef = db
      .collection('servers')
      .doc(actualServerId)
      .collection('leaderboard')
      .orderBy('points', 'desc')
      .limit(limit);

    const snapshot = await leaderboardRef.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}
