import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/data/server-init';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

type ActivityLeaderboardEntry = {
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  messageCount: number;
  voiceMinutes: number;
  helpfulReactions: number;
  streamAttendance: number;
  activeDays: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastSeenChannelId: string | null;
  lastSeenChannelName: string | null;
  activityScore: number;
};

function isAuthorized(request: NextRequest): boolean {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
}

function asNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toEntry(userId: string, data: Record<string, any>): ActivityLeaderboardEntry {
  const activity = data.discordActivity || {};
  const messageCount = asNumber(activity.messageCount);
  const voiceMinutes = asNumber(activity.voiceMinutes);
  const helpfulReactions = asNumber(activity.helpfulReactions);
  const streamAttendance = asNumber(activity.streamAttendance);
  const activeDays = asNumber(activity.activeDays);

  return {
    userId,
    username: activity.username || data.username,
    displayName: activity.displayName || data.displayName || data.username,
    avatarUrl: activity.avatarUrl || data.avatarUrl,
    messageCount,
    voiceMinutes,
    helpfulReactions,
    streamAttendance,
    activeDays,
    firstSeenAt: activity.firstSeenAt || null,
    lastSeenAt: activity.lastSeenAt || null,
    lastSeenChannelId: activity.lastSeenChannelId || null,
    lastSeenChannelName: activity.lastSeenChannelName || null,
    activityScore: messageCount + voiceMinutes + (helpfulReactions * 5) + (streamAttendance * 10) + (activeDays * 3),
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const serverId = body?.serverId || getHardcodedGuildId() || 'default';
    const limit = Math.max(1, Math.min(50, Number(body?.limit || 10)));

    const snapshot = await db.collection('servers').doc(serverId).collection('users').get();
    const entries = snapshot.docs
      .map((doc: any) => toEntry(doc.id, doc.data() || {}))
      .filter((entry: ReturnType<typeof toEntry>) => entry.activityScore > 0)
      .sort((a: ReturnType<typeof toEntry>, b: ReturnType<typeof toEntry>) => b.activityScore - a.activityScore || b.messageCount - a.messageCount || b.voiceMinutes - a.voiceMinutes)
      .slice(0, limit);

    return NextResponse.json(entries);
  } catch (error) {
    console.error('Error fetching Discord activity leaderboard:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
