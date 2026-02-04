'use server';

import { db } from '@/firebase/server-init';
import { getStreamByLogin } from '@/lib/twitch-api-service';
import { sendShoutoutToDiscord, getUserGroup } from '@/lib/shoutout-service';

interface PollingState {
  isPolling: boolean;
  serverId: string;
  lastShoutouts: Record<string, Date>; // twitchLogin -> last shoutout time
  intervalId?: NodeJS.Timeout;
}

class TwitchPollingService {
  private pollingStates: Map<string, PollingState> = new Map();
  private readonly POLLING_INTERVAL = 10 * 60 * 1000; // 10 minutes
  private readonly SHOUTOUT_COOLDOWN = 60 * 60 * 1000; // 1 hour
  private readonly TWITCH_RATE_DELAY = 1200; // 1.2s between Twitch API calls (50/min limit)
  private readonly DISCORD_RATE_DELAY = 600; // 0.6s between Discord API calls (100/min limit)
  private static instance: TwitchPollingService | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): TwitchPollingService {
    if (!TwitchPollingService.instance) {
      TwitchPollingService.instance = new TwitchPollingService();
    }
    return TwitchPollingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[TwitchPolling] Already initialized');
      return;
    }
    this.initialized = true;
    await this.initializePolling();
  }

  private async initializePolling(): Promise<void> {
    try {
      const serversSnapshot = await db.collection('servers').where('twitchPollingActive', '==', true).get();
      for (const doc of serversSnapshot.docs) {
        const serverId = doc.id;
        console.log(`[TwitchPolling] Auto-starting polling for server ${serverId}`);
        await this.startPolling(serverId).catch(err => 
          console.error(`[TwitchPolling] Failed to start polling for ${serverId}:`, err)
        );
      }
    } catch (error) {
      console.error('[TwitchPolling] Error initializing polling:', error);
    }
  }

  async startPolling(serverId: string): Promise<void> {
    if (this.pollingStates.has(serverId)) {
      console.log(`[TwitchPolling] Polling already active for server ${serverId}`);
      return;
    }

    console.log(`[TwitchPolling] Starting polling for server ${serverId}`);

    const state: PollingState = {
      isPolling: true,
      serverId,
      lastShoutouts: await this.loadLastShoutouts(serverId)
    };

    // Start the polling loop - runs every 10 minutes
    state.intervalId = setInterval(() => {
      this.pollTwitchStreams(serverId);
    }, this.POLLING_INTERVAL);

    this.pollingStates.set(serverId, state);
    await this.savePollingState(serverId, true);

    // Do initial poll immediately
    await this.pollTwitchStreams(serverId);
    console.log(`[TwitchPolling] Polling started - will run every ${this.POLLING_INTERVAL / 60000} minutes`);
  }

  async stopPolling(serverId: string): Promise<void> {
    const state = this.pollingStates.get(serverId);
    if (!state) {
      throw new Error('Polling is not active for this server');
    }

    console.log(`[TwitchPolling] Stopping polling for server ${serverId}`);

    if (state.intervalId) {
      clearInterval(state.intervalId);
    }

    this.pollingStates.delete(serverId);

    // Save polling state to database
    await this.savePollingState(serverId, false);
  }

  private async pollTwitchStreams(serverId: string): Promise<void> {
    try {
      const state = this.pollingStates.get(serverId);
      if (!state || !state.isPolling) return;

      console.log(`[TwitchPolling] Starting poll cycle for server ${serverId}`);
      const linkedUsers = await this.getLinkedTwitchUsers(serverId);
      if (linkedUsers.length === 0) {
        console.log(`[TwitchPolling] No linked users found`);
        return;
      }

      console.log(`[TwitchPolling] Checking ${linkedUsers.length} linked users`);

      // Get all stream statuses in one batch call (Twitch allows 100 per request)
      const logins = linkedUsers.map(u => u.twitchLogin);
      const { getStreamByLogin } = await import('./twitch-api-service');
      
      const streamStatuses = new Map<string, any>();
      for (const user of linkedUsers) {
        const stream = await getStreamByLogin(user.twitchLogin);
        streamStatuses.set(user.discordUserId, stream);
        await this.delay(this.TWITCH_RATE_DELAY); // Rate limit: 1.2s between calls
      }

      console.log(`[TwitchPolling] Found ${Array.from(streamStatuses.values()).filter(s => s).length} live streams`);

      // Process each user with rate limiting
      for (const user of linkedUsers) {
        const stream = streamStatuses.get(user.discordUserId);
        const shoutoutState = await this.getShoutoutState(serverId, user.discordUserId);

        if (stream) {
          // User is live
          if (shoutoutState?.messageId) {
            // Update existing shoutout
            await this.updateShoutout(serverId, user.discordUserId, stream, shoutoutState);
          } else {
            // Post new shoutout
            await this.postNewShoutout(serverId, user.discordUserId, user.twitchLogin, stream, state);
          }
          await this.delay(this.DISCORD_RATE_DELAY); // Rate limit Discord calls
        } else {
          // User went offline - delete shoutout
          if (shoutoutState?.messageId) {
            await this.deleteShoutout(serverId, user.discordUserId, shoutoutState);
            await this.delay(this.DISCORD_RATE_DELAY); // Rate limit Discord calls
          }
        }
      }

      // Rotate community spotlight
      try {
        const { manageCommunitySpotlight } = await import('./community-spotlight-service');
        await manageCommunitySpotlight(serverId);
      } catch (spotlightError) {
        console.error(`[TwitchPolling] Spotlight error:`, spotlightError);
      }

      console.log(`[TwitchPolling] Poll cycle completed for server ${serverId}`);
    } catch (error) {
      console.error(`[TwitchPolling] Error polling streams for server ${serverId}:`, error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async checkUserStream(serverId: string, user: any, state: PollingState): Promise<void> {
    // This method is no longer used - replaced by pollTwitchStreams batch processing
  }

  private async postNewShoutout(serverId: string, discordUserId: string, twitchLogin: string, stream: any, state: PollingState): Promise<void> {
    const lastShoutout = state.lastShoutouts[twitchLogin];
    if (lastShoutout && Date.now() - lastShoutout.getTime() < this.SHOUTOUT_COOLDOWN) {
      return;
    }

    const group = await getUserGroup(serverId, discordUserId);
    
    // Fetch new clip if Crew/Partners/Community
    if (group === 'Crew' || group === 'Partners' || group === 'Honored Guests' || group === 'Everyone Else') {
      const { fetchNewClipOnLive } = await import('./clip-rotation-service');
      await fetchNewClipOnLive(serverId, discordUserId, twitchLogin);
    }

    const shoutoutChannelId = await this.getChannelForGroup(serverId, group);
    if (!shoutoutChannelId) {
      console.warn(`[TwitchPolling] No channel configured for group ${group}`);
      return;
    }

    const messageId = await sendShoutoutToDiscord({
      serverId,
      channelId: shoutoutChannelId,
      twitchLogin,
      group
    });

    if (messageId) {
      await this.saveShoutoutState(serverId, discordUserId, {
        isLive: true,
        messageId,
        channelId: shoutoutChannelId,
        lastUpdated: new Date(),
        currentClipIndex: 0,
        streamStartedAt: new Date()
      });
    }

    state.lastShoutouts[twitchLogin] = new Date();
    await this.saveLastShoutout(serverId, twitchLogin, new Date());

    console.log(`[TwitchPolling] Posted ${group} shoutout for ${twitchLogin}`);
  }

  private async updateShoutout(serverId: string, discordUserId: string, stream: any, shoutoutState: any): Promise<void> {
    const group = await getUserGroup(serverId, discordUserId);
    const twitchLogin = stream.user_login;
    const { editDiscordMessage } = await import('./discord-sync-service');
    
    let embed;
    
    if (group === 'Crew') {
      const { getCurrentClipForUser } = await import('./clip-rotation-service');
      const clip = await getCurrentClipForUser(serverId, discordUserId);
      
      embed = {
        author: {
          name: `${stream.user_name} is now LIVE!`,
          icon_url: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif',
          url: `https://twitch.tv/${twitchLogin}`
        },
        title: `🚀 **${stream.title}**`,
        description: `🌟 **Space Mountain Crew Member** 🌟\n\nOne of our amazing crew members is live! They help keep Space Mountain running smoothly. Show them some love and join the stream!`,
        url: `https://twitch.tv/${twitchLogin}`,
        color: 0x00D9FF,
        fields: [
          { name: '🎮 Playing', value: stream.game_name, inline: true },
          { name: '👥 Viewers', value: stream.viewer_count.toString(), inline: true },
          { name: '🚀 Crew Status', value: 'Space Mountain Crew', inline: true }
        ],
        thumbnail: { url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180') },
        image: clip?.gifUrl ? { url: clip.gifUrl } : { url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • Crew Member Shoutout' },
        timestamp: new Date().toISOString()
      };
    } else if (group === 'Partners') {
      const { getCurrentClipForUser } = await import('./clip-rotation-service');
      const clip = await getCurrentClipForUser(serverId, discordUserId);
      
      embed = {
        author: {
          name: `${stream.user_name} is now LIVE!`,
          icon_url: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif',
          url: `https://twitch.tv/${twitchLogin}`
        },
        title: `🌌 **${stream.title}**`,
        description: `⭐ **Space Mountain Partner** ⭐\n\nOne of our official streaming partners is live! They're a valued member of the Space Mountain community. Show them some love and join the stream!`,
        url: `https://twitch.tv/${twitchLogin}`,
        color: 0x8B00FF,
        fields: [
          { name: '🎮 Playing', value: stream.game_name, inline: true },
          { name: '👥 Viewers', value: stream.viewer_count.toString(), inline: true },
          { name: '🌟 Partner Status', value: 'Official Space Mountain Partner', inline: true }
        ],
        thumbnail: { url: stream.profile_image_url },
        image: clip?.gifUrl ? { url: clip.gifUrl } : { url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • Space Mountain Partner Shoutout' },
        timestamp: new Date().toISOString()
      };
    } else if (group === 'Honored Guests') {
      const { getUserByLogin } = await import('./twitch-api-service');
      const userInfo = await getUserByLogin(twitchLogin);
      
      embed = {
        title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
        description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n\n✨ *Honored Guest*`,
        url: `https://twitch.tv/${twitchLogin}`,
        color: 0xFF8C00,
        thumbnail: { url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: { url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • Honored Guest' },
        timestamp: new Date().toISOString()
      };
    } else if (group === 'Raid Pile') {
      const { getUserByLogin } = await import('./twitch-api-service');
      const userInfo = await getUserByLogin(twitchLogin);
      
      embed = {
        title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
        description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
        url: `https://twitch.tv/${twitchLogin}`,
        color: 0x4ECDC4,
        thumbnail: { url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: { url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • Raid Pile Shoutout 🎯' },
        timestamp: new Date().toISOString()
      };
    } else {
      // Everyone Else - fetch user profile image
      const { getUserByLogin } = await import('./twitch-api-service');
      const userInfo = await getUserByLogin(twitchLogin);
      
      embed = {
        title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
        description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
        url: `https://twitch.tv/${twitchLogin}`,
        color: 0x9146FF,
        thumbnail: { url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: { url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • Mountaineer Shoutout' },
        timestamp: new Date().toISOString()
      };
    }
    
    try {
      await editDiscordMessage(serverId, shoutoutState.channelId, shoutoutState.messageId, { embeds: [embed] });
      console.log(`[TwitchPolling] Updated shoutout for ${stream.user_login}`);
    } catch (error) {
      console.log(`[TwitchPolling] Message deleted for ${stream.user_login}, clearing state`);
      await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
        .collection('shoutoutState').doc('current').delete();
    }
  }

  private async deleteShoutout(serverId: string, discordUserId: string, shoutoutState: any): Promise<void> {
    const { deleteDiscordMessage } = await import('./discord-sync-service');
    await deleteDiscordMessage(serverId, shoutoutState.channelId, shoutoutState.messageId);
    
    await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
      .collection('shoutoutState').doc('current').delete();

    console.log(`[TwitchPolling] Deleted shoutout for user ${discordUserId}`);
  }

  private async getShoutoutState(serverId: string, discordUserId: string): Promise<any> {
    const doc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
      .collection('shoutoutState').doc('current').get();
    return doc.exists ? doc.data() : null;
  }

  private async saveShoutoutState(serverId: string, discordUserId: string, state: any): Promise<void> {
    await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
      .collection('shoutoutState').doc('current').set(state);
  }

  private async getLinkedTwitchUsers(serverId: string): Promise<Array<{ twitchLogin: string; discordUserId: string }>> {
    try {
      const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
      const linkedUsers: Array<{ twitchLogin: string; discordUserId: string }> = [];

      usersSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.twitchLogin) {
          linkedUsers.push({
            twitchLogin: data.twitchLogin,
            discordUserId: doc.id
          });
        }
      });

      return linkedUsers;
    } catch (error) {
      console.error('[TwitchPolling] Error getting linked users:', error);
      return [];
    }
  }

  private async getShoutoutChannelId(serverId: string): Promise<string | null> {
    try {
      const serverDoc = await db.collection('servers').doc(serverId).get();
      const serverData = serverDoc.data();
      return serverData?.shoutoutChannelId || serverData?.crewChannelId || null;
    } catch (error) {
      console.error('[TwitchPolling] Error getting shoutout channel:', error);
      return null;
    }
  }

  private async getChannelForGroup(serverId: string, group: string): Promise<string | null> {
    try {
      const groupChannelsDoc = await db.collection('servers').doc(serverId).collection('config').doc('groupChannels').get();
      const groupChannels = groupChannelsDoc.data();
      
      if (!groupChannels) return null;
      
      // Map group names to saved channel IDs
      return groupChannels[group] || null;
    } catch (error) {
      console.error('[TwitchPolling] Error getting channel for group:', error);
      return null;
    }
  }

  private async loadLastShoutouts(serverId: string): Promise<Record<string, Date>> {
    try {
      const doc = await db.collection('servers').doc(serverId).collection('config').doc('twitch-polling').get();
      const data = doc.data();
      const lastShoutouts: Record<string, Date> = {};

      if (data?.lastShoutouts) {
        Object.entries(data.lastShoutouts).forEach(([login, timestamp]) => {
          lastShoutouts[login] = (timestamp as any).toDate();
        });
      }

      return lastShoutouts;
    } catch (error) {
      console.error('[TwitchPolling] Error loading last shoutouts:', error);
      return {};
    }
  }

  private async saveLastShoutout(serverId: string, twitchLogin: string, timestamp: Date): Promise<void> {
    try {
      const docRef = db.collection('servers').doc(serverId).collection('config').doc('twitch-polling');
      await docRef.set({
        lastShoutouts: {
          [twitchLogin]: timestamp
        }
      }, { merge: true });
    } catch (error) {
      console.error('[TwitchPolling] Error saving last shoutout:', error);
    }
  }

  private async savePollingState(serverId: string, isPolling: boolean): Promise<void> {
    try {
      await db.collection('servers').doc(serverId).update({
        twitchPollingActive: isPolling,
        lastPollingUpdate: new Date()
      });
    } catch (error) {
      console.error('[TwitchPolling] Error saving polling state:', error);
    }
  }

  async getPollingStatus(serverId: string): Promise<boolean> {
    const state = this.pollingStates.get(serverId);
    return state?.isPolling || false;
  }

  // Cleanup method for graceful shutdown
  cleanup(): void {
    for (const [serverId, state] of this.pollingStates) {
      if (state.intervalId) {
        clearInterval(state.intervalId);
      }
    }
    this.pollingStates.clear();
  }
}

const twitchPollingService = TwitchPollingService.getInstance();

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('SIGINT', () => {
    twitchPollingService.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    twitchPollingService.cleanup();
    process.exit(0);
  });
}

export async function startTwitchPolling(serverId: string): Promise<void> {
  return twitchPollingService.startPolling(serverId);
}

export async function stopTwitchPolling(serverId: string): Promise<void> {
  return twitchPollingService.stopPolling(serverId);
}

export async function getTwitchPollingStatus(serverId: string): Promise<boolean> {
  return twitchPollingService.getPollingStatus(serverId);
}

export async function initializeTwitchPolling(): Promise<void> {
  return twitchPollingService.initialize();
}
