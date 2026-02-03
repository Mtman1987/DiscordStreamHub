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
  private readonly POLLING_INTERVAL = 60 * 1000; // 1 minute
  private readonly SHOUTOUT_COOLDOWN = 60 * 60 * 1000; // 1 hour

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

      // Get all linked Twitch accounts for this server
      const linkedUsers = await this.getLinkedTwitchUsers(serverId);
      if (linkedUsers.length === 0) return;

      console.log(`[TwitchPolling] Checking ${linkedUsers.length} linked users for server ${serverId}`);

      // Check each user's stream status
      for (const user of linkedUsers) {
        await this.checkUserStream(serverId, user, state);
      }

    } catch (error) {
      console.error(`[TwitchPolling] Error polling streams for server ${serverId}:`, error);
    }
  }

  private async checkUserStream(serverId: string, user: any, state: PollingState): Promise<void> {
    try {
      const { twitchLogin, discordUserId } = user;

      // Check if user is on cooldown
      const lastShoutout = state.lastShoutouts[twitchLogin];
      if (lastShoutout && Date.now() - lastShoutout.getTime() < this.SHOUTOUT_COOLDOWN) {
        return; // Still on cooldown
      }

      // Check if user is currently streaming
      const stream = await getStreamByLogin(twitchLogin);
      if (!stream) return; // Not streaming

      // Get shoutout channel for this server
      const shoutoutChannelId = await this.getShoutoutChannelId(serverId);
      if (!shoutoutChannelId) {
        console.warn(`[TwitchPolling] No shoutout channel configured for server ${serverId}`);
        return;
      }

      // Get user's group for shoutout type
      const group = await getUserGroup(serverId, discordUserId);

      // Send shoutout
      await sendShoutoutToDiscord({
        serverId,
        channelId: shoutoutChannelId,
        twitchLogin,
        group
      });

      // Update last shoutout time
      state.lastShoutouts[twitchLogin] = new Date();
      await this.saveLastShoutout(serverId, twitchLogin, new Date());

      console.log(`[TwitchPolling] Sent ${group} shoutout for ${twitchLogin} in server ${serverId}`);

    } catch (error) {
      console.error(`[TwitchPolling] Error checking stream for ${user.twitchLogin}:`, error);
    }
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
      return serverData?.shoutoutChannelId || null;
    } catch (error) {
      console.error('[TwitchPolling] Error getting shoutout channel:', error);
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
