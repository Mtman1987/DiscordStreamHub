import { db } from '@/firebase/client';
import { collection, doc, getDoc, setDoc, updateDoc, increment, query, where, getDocs } from 'firebase/firestore';
import { PointsService } from './points-service';

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
      'follow': parseInt(process.env.POINTS_TWITCH_FOLLOW || '25'),
      'subscription': parseInt(process.env.POINTS_TWITCH_SUB || '100'),
      'bits': parseInt(process.env.POINTS_TWITCH_BITS || '1'),
      'raid': parseInt(process.env.POINTS_TWITCH_RAID || '50'),
      'host': parseInt(process.env.POINTS_TWITCH_HOST || '30'),
      'stream_attendance': parseInt(process.env.POINTS_STREAM_ATTENDANCE || '10')
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
      'message': parseInt(process.env.POINTS_DISCORD_MESSAGE || '1'),
      'reaction': parseInt(process.env.POINTS_DISCORD_REACTION || '2'),
      'voice_minute': parseInt(process.env.POINTS_DISCORD_VOICE_MINUTE || '5'),
      'help_reaction': parseInt(process.env.POINTS_DISCORD_HELP_REACTION || '10'),
      'community_help': parseInt(process.env.POINTS_COMMUNITY_HELP || '50')
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

    await setDoc(doc(collection(db, 'communityActivity')), activity);
  }

  private async updateUserMetrics(userId: string, username: string, displayName: string, activityType: string, metadata?: any): Promise<void> {
    const metricsRef = doc(db, 'userMetrics', userId);
    const metricsDoc = await getDoc(metricsRef);

    const updates: any = {
      userId,
      username,
      displayName,
      lastSeen: new Date().toISOString()
    };

    if (activityType === 'message') {
      updates.totalMessages = increment(1);
    } else if (activityType === 'help_reaction') {
      updates.helpfulReactions = increment(1);
    } else if (activityType === 'voice_minute') {
      updates.voiceMinutes = increment(metadata?.minutes || 1);
    } else if (activityType === 'stream_attendance') {
      updates.streamAttendance = increment(1);
    }

    if (metricsDoc.exists()) {
      await updateDoc(metricsRef, updates);
    } else {
      await setDoc(metricsRef, {
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
    const metricsRef = doc(db, 'userMetrics', userId);
    const metricsDoc = await getDoc(metricsRef);
    
    if (metricsDoc.exists()) {
      return metricsDoc.data() as UserMetrics;
    }
    return null;
  }

  async getTopContributors(limit: number = 10): Promise<UserMetrics[]> {
    const q = query(collection(db, 'userMetrics'));
    const querySnapshot = await getDocs(q);
    
    const contributors: UserMetrics[] = [];
    querySnapshot.forEach(doc => {
      contributors.push(doc.data() as UserMetrics);
    });

    return contributors
      .sort((a, b) => (b.helpfulReactions + b.totalMessages) - (a.helpfulReactions + a.totalMessages))
      .slice(0, limit);
  }

  async processDailyBonus(): Promise<void> {
    const dailyBonus = parseInt(process.env.POINTS_DAILY_BONUS || '20');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const q = query(
      collection(db, 'userMetrics'),
      where('lastSeen', '>=', yesterday.toISOString())
    );
    
    const querySnapshot = await getDocs(q);
    const pointsService = PointsService.getInstance();
    
    for (const doc of querySnapshot.docs) {
      const user = doc.data() as UserMetrics;
      await pointsService.addPoints(user.userId, user.username, user.displayName, dailyBonus);
      
      await updateDoc(doc.ref, {
        dailyStreak: increment(1)
      });
    }
  }
}