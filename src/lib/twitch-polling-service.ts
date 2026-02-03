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
  private static instance: TwitchPollingService;

  constructor() {
    if (TwitchPollingService.instance) {
      return TwitchPollingService.instance;
    }
    TwitchPollingService.instance = this;
    this.initializePolling();
  }

  private async initializePolling(): Promise<void> {
    // Auto-start polling for all servers on app startup
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
      throw new Error('Polling is already active for this server');
    }

    console.log(`[TwitchPolling] Starting polling for server ${serverId}`);

    // Initialize polling state
    const state: PollingState = {
      isPolling: true,
      serverId,
      lastShoutouts: await this.loadLastShoutouts(serverId)
    };

    // Start the polling loop
    state.intervalId = setInterval(() => {
      this.pollTwitchStreams(serverId);
    }, this.POLLING_INTERVAL);

    this.pollingStates.set(serverId, state);

    // Save polling state to database
    await this.savePollingState(serverId, true);

    // Do initial poll
    await this.pollTwitchStreams(serverId);
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

      const linkedUsers = await this.getLinkedTwitchUsers(serverId);
      if (linkedUsers.length === 0) return;

      console.log(`[TwitchPolling] Checking ${linkedUsers.length} linked users for server ${serverId}`);

      for (const user of linkedUsers) {
        await this.checkUserStream(serverId, user, state);
      }

      // Rotate community spotlight every 10 minutes
      const { manageCommunitySpotlight } = await import('./community-spotlight-service');
      await manageCommunitySpotlight(serverId);

    } catch (error) {
      console.error(`[TwitchPolling] Error polling streams for server ${serverId}:`, error);
    }
  }

  private async checkUserStream(serverId: string, user: any, state: PollingState): Promise<void> {
    try {
      const { twitchLogin, discordUserId } = user;

      // Check if user is currently streaming
      const stream = await getStreamByLogin(twitchLogin);
      const shoutoutState = await this.getShoutoutState(serverId, discordUserId);

      if (stream) {
        // User is live
        if (shoutoutState?.messageId) {
          // Update existing shoutout
          await this.updateShoutout(serverId, discordUserId, stream, shoutoutState);
        } else {
          // Post new shoutout
          await this.postNewShoutout(serverId, discordUserId, twitchLogin, stream, state);
        }
      } else {
        // User went offline
        if (shoutoutState?.messageId) {
          await this.deleteShoutout(serverId, discordUserId, shoutoutState);
        }
      }

    } catch (error) {
      console.error(`[TwitchPolling] Error checking stream for ${user.twitchLogin}:`, error);
    }
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
    
    if (group === 'Crew' || group === 'Partners') {
      const newClipIndex = (shoutoutState.currentClipIndex || 0) + 1;
      await this.saveShoutoutState(serverId, discordUserId, {
        ...shoutoutState,
        currentClipIndex: newClipIndex,
        lastUpdated: new Date()
      });
      
      // Regenerate shoutout with new clip
      const { sendShoutoutToDiscord } = await import('./shoutout-service');
      const { editDiscordMessage } = await import('./discord-sync-service');
      const { getStreamByLogin } = await import('./twitch-api-service');
      
      const updatedStream = await getStreamByLogin(stream.user_login);
      if (updatedStream) {
        const twitchLogin = stream.user_login;
        const baseMessage = `🚨 **${updatedStream.user_name}** is now LIVE on Twitch!`;
        
        // Get updated clip
        const { getCurrentClipForUser } = await import('./clip-rotation-service');
        const clip = await getCurrentClipForUser(serverId, discordUserId);
        
        const embed = {
          title: baseMessage,
          description: `**${updatedStream.title}**\n🎮 Playing: ${updatedStream.game_name}\n👥 Viewers: ${updatedStream.viewer_count}`,
          url: `https://twitch.tv/${twitchLogin}`,
          color: group === 'Crew' ? 0x00FFFF : 0x9146FF,
          image: clip?.gifUrl ? { url: clip.gifUrl } : { url: updatedStream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
          footer: { text: `Twitch • ${group} Shoutout` },
          timestamp: new Date().toISOString()
        };
        
        await editDiscordMessage(serverId, shoutoutState.channelId, shoutoutState.messageId, { embeds: [embed] });
      }
    }

    console.log(`[TwitchPolling] Updated shoutout for ${stream.user_login}`);
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
      const serverDoc = await db.collection('servers').doc(serverId).get();
      const serverData = serverDoc.data();
      
      switch (group) {
        case 'Crew':
          return serverData?.crewChannelId || null;
        case 'Partners':
          return serverData?.partnersChannelId || null;
        case 'Honored Guests':
        case 'Everyone Else':
          return serverData?.communityChannelId || null;
        case 'Raid Pile':
          return serverData?.raidPileChannelId || null;
        default:
          return serverData?.shoutoutChannelId || null;
      }
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

const twitchPollingService = new TwitchPollingService();

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
