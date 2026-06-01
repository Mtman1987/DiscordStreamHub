import { db } from '@/data/server-init';
import { PointsService } from './points-service';
import {
  getPointsCommunityHelp,
  getPointsDailyBonus,
  getPointsDiscordHelpReaction,
  getPointsDiscordMessage,
  getPointsDiscordReaction,
  getPointsDiscordVoiceMinute,
  getPointsStreamAttendance,
  getPointsTwitchBits,
  getPointsTwitchFollow,
  getPointsTwitchHost,
  getPointsTwitchRaid,
  getPointsTwitchSub,
} from './runtime-config';

export interface CommunityActivity {
  userId: string;
  username: string;
  displayName: string;
  platform: 'twitch' | 'discord';
  activityType: string;
  points: number;
  timestamp: string;
  metadata?: any;
}

export interface UserMetrics {
  userId: string;
  username: string;
  displayName: string;
  totalMessages: number;
  helpfulReactions: number;
  voiceMinutes: number;
  streamAttendance: number;
  lastSeen: string;
  dailyStreak: number;
}

export class CommunityTrackingService {
  private static instance: CommunityTrackingService;
  
  static getInstance(): CommunityTrackingService {
    if (!CommunityTrackingService.instance) {
      CommunityTrackingService.instance = new CommunityTrackingService();
    }
    return CommunityTrackingService.instance;
  }

  async trackTwitchActivity(userId: string, username: string, displayName: string, activityType: string, metadata?: any): Promise<void> {
    const pointsConfig = {
      'follow': getPointsTwitchFollow(),
      'subscription': getPointsTwitchSub(),
      'bits': getPointsTwitchBits(),
      'raid': getPointsTwitchRaid(),
      'host': getPointsTwitchHost(),
      'stream_attendance': getPointsStreamAttendance(),
    };

    const points = pointsConfig[activityType as keyof typeof pointsConfig] || 0;
    if (activityType === 'bits' && metadata?.amount) {
      const bitsPoints = Math.floor(metadata.amount * points);
      await this.awardPoints(userId, username, displayName, bitsPoints, 'twitch', activityType, metadata);
    } else if (points > 0) {
      await this.awardPoints(userId, username, displayName, points, 'twitch', activityType, metadata);
    }

    await this.updateUserMetrics(userId, username, displayName, activityType, metadata);
  }

  async trackDiscordActivity(userId: string, username: string, displayName: string, activityType: string, metadata?: any): Promise<void> {
    const pointsConfig = {
      'message': getPointsDiscordMessage(),
      'reaction': getPointsDiscordReaction(),
      'voice_minute': getPointsDiscordVoiceMinute(),
      'help_reaction': getPointsDiscordHelpReaction(),
      'community_help': getPointsCommunityHelp(),
    };

    const points = pointsConfig[activityType as keyof typeof pointsConfig] || 0;
    if (points > 0) {
      await this.awardPoints(userId, username, displayName, points, 'discord', activityType, metadata);
    }

    await this.updateUserMetrics(userId, username, displayName, activityType, metadata);
  }

  private async awardPoints(userId: string, username: string, displayName: string, points: number, platform: string, activityType: string, metadata?: any): Promise<void> {
    const pointsService = PointsService.getInstance();
    await pointsService.addPoints(userId, username, displayName, points);

    // Log activity
    const activity: CommunityActivity = {
      userId,
      username,
      displayName,
      platform: platform as 'twitch' | 'discord',
      activityType,
      points,
      timestamp: new Date().toISOString(),
      metadata
    };

    await db.collection('communityActivity').doc().set(activity);
  }

  private async updateUserMetrics(userId: string, username: string, displayName: string, activityType: string, metadata?: any): Promise<void> {
    const metricsRef = db.collection('userMetrics').doc(userId);
    const metricsDoc = await metricsRef.get();

    const updates: any = {
      userId,
      username,
      displayName,
      lastSeen: new Date().toISOString()
    };

    if (activityType === 'message') {
      updates.totalMessages = (metricsDoc.data()?.totalMessages || 0) + 1;
    } else if (activityType === 'help_reaction') {
      updates.helpfulReactions = (metricsDoc.data()?.helpfulReactions || 0) + 1;
    } else if (activityType === 'voice_minute') {
      updates.voiceMinutes = (metricsDoc.data()?.voiceMinutes || 0) + (metadata?.minutes || 1);
    } else if (activityType === 'stream_attendance') {
      updates.streamAttendance = (metricsDoc.data()?.streamAttendance || 0) + 1;
    }

    if (metricsDoc.exists()) {
      await metricsRef.update(updates);
    } else {
      await metricsRef.set({
        ...updates,
        totalMessages: activityType === 'message' ? 1 : 0,
        helpfulReactions: activityType === 'help_reaction' ? 1 : 0,
        voiceMinutes: activityType === 'voice_minute' ? (metadata?.minutes || 1) : 0,
        streamAttendance: activityType === 'stream_attendance' ? 1 : 0,
        dailyStreak: 0
      });
    }
  }

  async getUserMetrics(userId: string): Promise<UserMetrics | null> {
    const metricsRef = db.collection('userMetrics').doc(userId);
    const metricsDoc = await metricsRef.get();
    
    if (metricsDoc.exists()) {
      return metricsDoc.data() as UserMetrics;
    }
    return null;
  }

  async getTopContributors(limit: number = 10): Promise<UserMetrics[]> {
    const snapshot = await db.collection('userMetrics').get();
    const contributors = snapshot.docs.map(doc => doc.data() as UserMetrics);

    return contributors
      .sort((a, b) => (b.helpfulReactions + b.totalMessages) - (a.helpfulReactions + a.totalMessages))
      .slice(0, limit);
  }

  async processDailyBonus(): Promise<void> {
    const dailyBonus = getPointsDailyBonus();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const querySnapshot = await db.collection('userMetrics').get();
    const pointsService = PointsService.getInstance();
    
    for (const doc of querySnapshot.docs.filter((entry) => {
      const user = entry.data() as UserMetrics;
      return user.lastSeen >= yesterday.toISOString();
    })) {
      const user = doc.data() as UserMetrics;
      await pointsService.addPoints(user.userId, user.username, user.displayName, dailyBonus);
      
      await doc.ref.update({
        dailyStreak: (user.dailyStreak || 0) + 1
      });
    }
  }
}
