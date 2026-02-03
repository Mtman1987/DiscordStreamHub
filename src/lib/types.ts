import { LucideIcon } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';

export interface NavItem {
  title: string;
  href: string;
  icon: React.ReactNode;
}

export interface DiscordServer {
  serverId: string;
  serverName: string;
  adminRoles?: string[];
}

export interface UserProfile {
  id: string; // Firestore document ID
  discordUserId: string;
  username: string;
  avatarUrl: string;
  isOnline: boolean;
  topic?: string;
  group: 'VIP' | 'Community' | 'Raid Train' | 'Raid Pile';
  roles: string[];
  dailyShoutout?: any; // This will be the Discord Embed JSON
  shoutoutGeneratedAt?: Timestamp;
  lastTwitchData?: {
    viewerCount?: number;
    gameTitle?: string;
    isLive?: boolean;
    updatedAt?: Timestamp | Date | string;
  };
}

export interface CalendarEvent {
  id: string; // Firestore document ID
  eventName: string;
  eventDateTime: Timestamp;
  description: string;
  type: 'event' | 'meeting' | 'qotd' | 'captains-log';
  userId: string;
  userAvatar: string;
  username: string;
}

export interface LeaderboardEntry {
  id: string; // Firestore document ID
  userProfileId: string;
  points: number;
  lastUpdated: string;
  lastEventType?: string;
  lastEventSource?: string;
  lastEventMetadata?: Record<string, unknown> | null;
}

export interface LeaderboardSettings {
    raidPoints: number;
    followPoints: number;
    subPoints: number;
    giftedSubPoints: number;
    bitPoints: number;
    chatActivityPoints: number;
    firstMessagePoints: number;
    messageReactionPoints: number;
    adminEventPoints: number;
    adminLogPoints: number;
    adminMessagePoints: number;
}

export interface DiscordMessage {
    id: string; // Firestore document ID
    channelId: string;
    userProfileId: string;
    messageContent: string;
    timestamp: Timestamp;
    originalAuthor: {
        name: string;
        avatar: string;
    };
    forwardedMessageId?: string;
    reply?: {
        text: string;
        authorId: string;
        authorName: string;
        authorAvatar: string;
        timestamp: Timestamp | Date; // Allow both for optimistic updates
    };
}
