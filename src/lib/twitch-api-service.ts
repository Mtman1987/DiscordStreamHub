'use server';

import { getTwitchClientId } from '@/lib/runtime-config';

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  title: string;
  viewer_count: number;
  started_at: string;
  thumbnail_url: string;
  is_mature?: boolean;
}

interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
}

class TwitchApiService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.clientId = getTwitchClientId();
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET!;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TwitchAPI] Token request failed:', response.status, errorText);
      throw new Error(`Failed to get Twitch access token: ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1 minute buffer

    return data.access_token;
  }

  private async makeApiCall(endpoint: string): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getAccessToken();

      const response = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        return response.json();
      }

      const errorText = await response.text();
      if (response.status === 401 && attempt === 0) {
        console.warn(`[TwitchAPI] App token was rejected for ${endpoint}; refreshing once.`);
        this.accessToken = null;
        this.tokenExpiry = 0;
        continue;
      }

      console.error(`Twitch API error for ${endpoint}: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`Twitch API error: ${response.statusText}`);
    }

    throw new Error('Twitch API request did not complete');
  }

  async getUserByLogin(login: string): Promise<TwitchUser | null> {
    try {
      const data = await this.makeApiCall(`users?login=${login}`);
      return data.data[0] || null;
    } catch (error) {
      console.error(`Error fetching user ${login}:`, error);
      return null;
    }
  }

  async getStreamByUserId(userId: string): Promise<TwitchStream | null> {
    try {
      const data = await this.makeApiCall(`streams?user_id=${userId}`);
      return data.data[0] || null;
    } catch (error) {
      console.error(`Error fetching stream for user ${userId}:`, error);
      return null;
    }
  }

  async getStreamByLogin(login: string): Promise<TwitchStream | null> {
    try {
      const data = await this.makeApiCall(`streams?user_login=${login}`);
      return data.data[0] || null;
    } catch (error) {
      console.error(`Error fetching stream for ${login}:`, error);
      return null;
    }
  }

  async getClipsForUser(userId: string, limit: number = 20): Promise<TwitchClip[]> {
    try {
      const data = await this.makeApiCall(`clips?broadcaster_id=${userId}&first=${limit}`);
      return data.data || [];
    } catch (error) {
      console.error(`Error fetching clips for user ${userId}:`, error);
      return [];
    }
  }

  async getTwitchUserClips(login: string, limit: number = 20): Promise<TwitchClip[]> {
    const user = await this.getUserByLogin(login);
    if (!user) {
      return [];
    }

    return this.getClipsForUser(user.id, limit);
  }

  async createClip(_userId: string, _serverId?: string): Promise<string | null> {
    // Legacy callers expect this helper to exist, but the current app no longer
    // has a safe server-side flow for creating Twitch clips here.
    return null;
  }

  async getStreamsByLogins(userLogins: string[]): Promise<Map<string, TwitchStream>> {
    const streamMap = new Map<string, TwitchStream>();

    try {
      const normalizedLogins = Array.from(new Set(
        userLogins
          .map(login => String(login || '').trim().toLowerCase())
          .filter(login => /^[a-z0-9_]{1,25}$/.test(login))
      ));

      for (let i = 0; i < normalizedLogins.length; i += 50) {
        const chunk = normalizedLogins.slice(i, i + 50);
        if (chunk.length === 0) continue;

        const params = new URLSearchParams();
        chunk.forEach(login => params.append('user_login', login));
        const data = await this.makeApiCall(`streams?${params.toString()}`);

        for (const stream of (data.data || []) as TwitchStream[]) {
          streamMap.set(stream.user_login.toLowerCase(), stream);
        }
      }
    } catch (error) {
      console.error('[TwitchAPI] Error fetching streams by logins:', error);
    }

    return streamMap;
  }

  async getRandomClipFromOnlineUsers(userLogins: string[]): Promise<TwitchClip | null> {
    try {
      // Get all online streams
      const onlineStreams: TwitchStream[] = [];
      for (const login of userLogins) {
        const stream = await this.getStreamByLogin(login);
        if (stream) {
          onlineStreams.push(stream);
        }
      }

      if (onlineStreams.length === 0) {
        return null;
      }

      // Pick a random online streamer
      const randomStream = onlineStreams[Math.floor(Math.random() * onlineStreams.length)];
      
      // Get their clips
      const clips = await this.getClipsForUser(randomStream.user_id, 10);
      
      if (clips.length === 0) {
        return null;
      }

      // Return a random clip
      return clips[Math.floor(Math.random() * clips.length)];
    } catch (error) {
      console.error('Error getting random clip:', error);
      return null;
    }
  }

  async checkMultipleStreamsStatus(userLogins: string[]): Promise<Map<string, boolean>> {
    const statusMap = new Map<string, boolean>();

    try {
      // Filter out invalid Twitch usernames (only alphanumeric and underscores allowed)
      const normalizedLogins = Array.from(new Set(userLogins.map(login => login.toLowerCase())));
      const validLogins = normalizedLogins.filter(login => /^[a-z0-9_]{1,25}$/.test(login));
      const invalidLogins = normalizedLogins.filter(login => !/^[a-z0-9_]{1,25}$/.test(login));
      if (invalidLogins.length > 0) {
        console.warn(`[TwitchAPI] Skipping ${invalidLogins.length} invalid usernames:`, invalidLogins.slice(0, 10));
        invalidLogins.forEach(login => statusMap.set(login, false));
      }

      const checkChunk = async (chunk: string[]): Promise<number> => {
        if (chunk.length === 0) return 0;

        const params = new URLSearchParams();
        chunk.forEach(login => params.append('user_login', login));
        const endpoint = `streams?${params.toString()}`;
        try {
          const data = await this.makeApiCall(endpoint);

          chunk.forEach(login => statusMap.set(login, false));

          data.data.forEach((stream: TwitchStream) => {
            statusMap.set(stream.user_login.toLowerCase(), true);
          });

          return data.data.length;
        } catch (error) {
          if (chunk.length === 1) {
            console.warn(`[TwitchAPI] Skipping rejected username ${chunk[0]} after Twitch API error:`, error);
            statusMap.set(chunk[0], false);
            return 0;
          }

          console.warn(`[TwitchAPI] Chunk of ${chunk.length} users failed; splitting to isolate bad params.`);
          const midpoint = Math.ceil(chunk.length / 2);
          const leftOnline = await checkChunk(chunk.slice(0, midpoint));
          const rightOnline = await checkChunk(chunk.slice(midpoint));
          return leftOnline + rightOnline;
        }
      };

      // Keep chunks below Twitch's documented max so long usernames do not create oversized URLs.
      const chunks: string[][] = [];
      for (let i = 0; i < validLogins.length; i += 50) {
        chunks.push(validLogins.slice(i, i + 50));
      }

      let totalOnline = 0;
      for (const chunk of chunks) {
        totalOnline += await checkChunk(chunk);
      }

    } catch (error) {
      console.error('Error checking stream status:', error);
    }

    return statusMap;
  }
}

const twitchApiService = new TwitchApiService();

export async function getUserByLogin(login: string): Promise<TwitchUser | null> {
  return twitchApiService.getUserByLogin(login);
}

export async function getStreamByUserId(userId: string): Promise<TwitchStream | null> {
  return twitchApiService.getStreamByUserId(userId);
}

export async function getStreamByLogin(login: string): Promise<TwitchStream | null> {
  return twitchApiService.getStreamByLogin(login);
}

export async function getClipsForUser(userId: string, limit: number = 5): Promise<TwitchClip[]> {
  return twitchApiService.getClipsForUser(userId, limit);
}

export async function getTwitchUserClips(login: string, limit: number = 5): Promise<TwitchClip[]> {
  return twitchApiService.getTwitchUserClips(login, limit);
}

export async function createClip(userId: string, serverId?: string): Promise<string | null> {
  return twitchApiService.createClip(userId, serverId);
}

export async function getStreamsByLogins(userLogins: string[]): Promise<Map<string, TwitchStream>> {
  return twitchApiService.getStreamsByLogins(userLogins);
}

export async function getRandomClipFromOnlineUsers(userLogins: string[]): Promise<TwitchClip | null> {
  return twitchApiService.getRandomClipFromOnlineUsers(userLogins);
}

export async function checkMultipleStreamsStatus(userLogins: string[]): Promise<Map<string, boolean>> {
  return twitchApiService.checkMultipleStreamsStatus(userLogins);
}
