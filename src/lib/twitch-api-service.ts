'use server';

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
    this.clientId = process.env.TWITCH_CLIENT_ID!;
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET!;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    console.log('[TwitchAPI] Getting new access token...');
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
    console.log('[TwitchAPI] Access token acquired successfully');

    return this.accessToken;
  }

  private async makeApiCall(endpoint: string): Promise<any> {
    const token = await this.getAccessToken();
    
    const response = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
      headers: {
        'Client-ID': this.clientId,
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Twitch API error for ${endpoint}: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`Twitch API error: ${response.statusText}`);
    }

    return response.json();
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
      console.log(`[TwitchAPI] Checking ${userLogins.length} users for live status`);
      console.log(`[TwitchAPI] Sample usernames:`, userLogins.slice(0, 5));
      
      // Twitch API allows up to 100 user_login parameters
      const chunks = [];
      for (let i = 0; i < userLogins.length; i += 100) {
        chunks.push(userLogins.slice(i, i + 100));
      }

      let totalOnline = 0;
      for (const chunk of chunks) {
        const params = new URLSearchParams();
        chunk.forEach(login => params.append('user_login', login));
        const endpoint = `streams?${params.toString()}`.replace(/&amp;/g, '&');
        console.log(`[TwitchAPI] Calling endpoint for ${chunk.length} users`);
        const data = await this.makeApiCall(endpoint);
        
        console.log(`[TwitchAPI] Found ${data.data.length} live streams in this chunk`);
        
        // Mark all as offline first
        chunk.forEach(login => statusMap.set(login, false));
        
        // Mark online ones as true
        data.data.forEach((stream: TwitchStream) => {
          statusMap.set(stream.user_login, true);
          totalOnline++;
          console.log(`[TwitchAPI] ${stream.user_login} is live: ${stream.game_name}`);
        });
      }
      
      console.log(`[TwitchAPI] Total online users found: ${totalOnline}`);
    } catch (error) {
      console.error('Error checking stream status:', error);
      // Return all as offline on error
      userLogins.forEach(login => statusMap.set(login, false));
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

export async function getRandomClipFromOnlineUsers(userLogins: string[]): Promise<TwitchClip | null> {
  return twitchApiService.getRandomClipFromOnlineUsers(userLogins);
}

export async function checkMultipleStreamsStatus(userLogins: string[]): Promise<Map<string, boolean>> {
  return twitchApiService.checkMultipleStreamsStatus(userLogins);
}
