'use server';

import { getMediaForUser } from './media-fallback-service';

// Helper functions for different use cases
export async function getShoutoutMedia(username: string, serverId?: string): Promise<string | null> {
  return getMediaForUser({
    username,
    mediaType: 'gif',
    contentType: 'shoutout',
    serverId
  });
}

export async function getSpotlightMedia(username: string, serverId?: string): Promise<string | null> {
  return getMediaForUser({
    username,
    mediaType: 'gif',
    contentType: 'spotlight',
    serverId
  });
}

export async function getVipMedia(username: string, serverId?: string): Promise<string | null> {
  return getMediaForUser({
    username,
    mediaType: 'gif',
    contentType: 'vip',
    serverId
  });
}

export async function getCalendarImage(serverId?: string): Promise<string | null> {
  return getMediaForUser({
    username: 'calendar',
    mediaType: 'image',
    contentType: 'calendar',
    serverId
  });
}

export async function getLeaderboardImage(serverId?: string): Promise<string | null> {
  return getMediaForUser({
    username: 'leaderboard',
    mediaType: 'image',
    contentType: 'leaderboard',
    serverId
  });
}