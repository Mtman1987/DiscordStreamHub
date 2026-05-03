'use server';

import { db } from '@/lib/db';
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

    // Do NOT set interval yet - wait for initialization to complete
    this.pollingStates.set(serverId, state);
    await this.savePollingState(serverId, true);

    // Sweep orphaned messages before first poll
    try {
      await this.sweepOrphanedMessages(serverId);
    } catch (error) {
      console.error('[TwitchPolling] Orphan sweep failed:', error);
    }

    // Run initial poll synchronously
    try {
      await this.pollTwitchStreams(serverId);
    } catch (error) {
      console.error('[TwitchPolling] Initial poll failed:', error);
    }
    
    // Start chat monitoring before interval
    try {
      console.log('[TwitchPolling] Importing chat service...');
      const { twitchChatService } = await import('./twitch-chat-service');
      console.log('[TwitchPolling] Starting chat service...');
      await twitchChatService.start(serverId);
      console.log('[TwitchPolling] Chat service started successfully');
    } catch (error) {
      console.error('[TwitchPolling] Failed to start chat service:', error);
    }
    
    // Now set the interval after all setup is complete
    state.intervalId = setInterval(() => {
      this.pollTwitchStreams(serverId).catch(err => 
        console.error(`[TwitchPolling] Polling error for ${serverId}:`, err)
      );
    }, this.POLLING_INTERVAL);
    
    console.log(`[TwitchPolling] Polling started - will run every ${this.POLLING_INTERVAL / 60000} minutes`);
  }

  async stopPolling(serverId: string): Promise<void> {
    const state = this.pollingStates.get(serverId);
    if (!state) {
      console.log(`[TwitchPolling] Polling already stopped for server ${serverId}`);
      await this.savePollingState(serverId, false);
      return;
    }

    console.log(`[TwitchPolling] Stopping polling for server ${serverId}`);

    if (state.intervalId) {
      clearInterval(state.intervalId);
    }

    this.pollingStates.delete(serverId);

    // Save polling state to database
    await this.savePollingState(serverId, false);
  }

  async pollNow(serverId: string): Promise<void> {
    const existing = this.pollingStates.get(serverId);
    let createdTempState = false;

    if (!existing) {
      const tempState: PollingState = {
        isPolling: true,
        serverId,
        lastShoutouts: await this.loadLastShoutouts(serverId),
      };
      this.pollingStates.set(serverId, tempState);
      createdTempState = true;
    }

    try {
      await this.pollTwitchStreams(serverId);
    } finally {
      if (createdTempState) {
        this.pollingStates.delete(serverId);
      }
    }
  }

  private async pollTwitchStreams(serverId: string): Promise<void> {
    try {
      const state = this.pollingStates.get(serverId);
      if (!state || !state.isPolling) return;

      console.log(`[TwitchPolling] Starting poll cycle for server ${serverId}`);

      // Sync channels and roles only (NOT members - that overwrites group assignments)
      try {
        const { syncChannelsAndRoles } = await import('./discord-sync-service');
        await syncChannelsAndRoles(serverId);
        console.log(`[TwitchPolling] Discord channel/role sync completed`);
      } catch (syncErr) {
        console.error(`[TwitchPolling] Discord sync failed (non-fatal):`, syncErr);
      }

      // Apply role mappings to keep groups in sync with Discord roles
      try {
        const serverDoc = await db.collection('servers').doc(serverId).get();
        const roleMappings: Record<string, string> = serverDoc.data()?.roleMappings || {};
        if (Object.keys(roleMappings).length > 0) {
          const priorityOrder = ['Crew', 'Partners', 'Honored Guests', 'Raid Pile', 'Everyone Else'];
          const usersSnap = await db.collection('servers').doc(serverId).collection('users').get();
          const batch = db.batch();
          let fixCount = 0;
          for (const userDoc of usersSnap.docs) {
            const data = userDoc.data();
            const userRoles: string[] = data.roles || [];
            let correctGroup: string | null = null;
            for (const groupName of priorityOrder) {
              for (const roleId of userRoles) {
                if (roleMappings[roleId] === groupName) { correctGroup = groupName; break; }
              }
              if (correctGroup) break;
            }
            if (correctGroup && data.group !== correctGroup) {
              batch.update(userDoc.ref, { group: correctGroup });
              fixCount++;
            }
          }
          if (fixCount > 0) {
            await batch.commit();
            console.log(`[TwitchPolling] ✅ Role mapping applied: fixed ${fixCount} user groups`);
          }
        }
      } catch (roleSyncErr) {
        console.error(`[TwitchPolling] Role mapping sync failed (non-fatal):`, roleSyncErr);
      }

      const linkedUsers = await this.getLinkedTwitchUsers(serverId);
      if (linkedUsers.length === 0) {
        console.log(`[TwitchPolling] No linked users found`);
        return;
      }

      console.log(`[TwitchPolling] Checking ${linkedUsers.length} linked users`);

      // Get live statuses via chat-tag's Twitch API (batched, fast)
      const CHAT_TAG_URL = process.env.CHAT_TAG_URL || 'https://chat-tag-new.fly.dev';
      const logins = linkedUsers.map(u => u.twitchLogin);
      let liveUsers: any[] = [];
      try {
        const liveRes = await fetch(`${CHAT_TAG_URL}/api/twitch/live`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: logins }),
        });
        if (liveRes.ok) {
          const liveData = await liveRes.json();
          liveUsers = liveData.liveUsers || [];
          console.log(`[TwitchPolling] Chat-tag returned ${liveUsers.length} live users`);
        } else {
          console.error(`[TwitchPolling] Chat-tag live API returned ${liveRes.status}: ${await liveRes.text()}`);
        }
      } catch (e) {
        console.error('[TwitchPolling] Failed to fetch live data from chat-tag:', e);
      }

      // Build a map of twitchLogin -> stream data
      const liveByLogin = new Map<string, any>();
      for (const u of liveUsers) {
        const login = (u.username || u.login || '').toLowerCase();
        if (!login) continue;
        liveByLogin.set(login, {
          user_name: u.displayName || u.display_name || login,
          user_login: login,
          title: u.title || '',
          game_name: u.gameName || u.game_name || 'Unknown',
          viewer_count: u.viewerCount || u.viewer_count || 0,
          thumbnail_url: u.thumbnailUrl || u.thumbnail_url || '',
        });
      }

      const streamStatuses = new Map<string, any>();
      for (const user of linkedUsers) {
        const stream = liveByLogin.get(user.twitchLogin.toLowerCase()) || null;
        streamStatuses.set(user.discordUserId, stream);
      }

      console.log(`[TwitchPolling] Found ${Array.from(streamStatuses.values()).filter(s => s).length} live streams`);

      // Process each user with rate limiting
      const isOnlineBatch = db.batch();
      let onlineChanges = 0;
      for (const user of linkedUsers) {
        const stream = streamStatuses.get(user.discordUserId);
        const isLive = !!stream;
        // Update isOnline on user doc so the app UI stays in sync
        isOnlineBatch.update(
          db.collection('servers').doc(serverId).collection('users').doc(user.discordUserId),
          { isOnline: isLive }
        );
        onlineChanges++;
        if (onlineChanges >= 450) {
          await isOnlineBatch.commit();
          onlineChanges = 0;
        }
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

      // Commit any remaining isOnline updates
      if (onlineChanges > 0) {
        await isOnlineBatch.commit();
      }

      // Rotate community spotlight
      try {
        // Clip fetching is handled by the separate clip-worker app.
      // DSH just reads existing GIFs from /data/clips/{streamer}/ at render time.
      // No clip conversion happens in the main app process.
        
        const { manageCommunitySpotlight } = await import('./community-spotlight-service');
        await manageCommunitySpotlight(serverId);
        
        // Update linking embed with new random member
        await this.updateLinkingEmbed(serverId);
      } catch (spotlightError) {
        console.error(`[TwitchPolling] Spotlight error:`, spotlightError);
      }
      
      // Update chat channels
      try {
        const { twitchChatService } = await import('./twitch-chat-service');
        await twitchChatService.updateChannels();
      } catch (chatError) {
        console.error(`[TwitchPolling] Chat update error:`, chatError);
      }

      // Refresh leaderboard embed in Discord
      try {
        const leaderboardMeta = await db.collection('servers').doc(serverId).collection('config').doc('leaderboardMessage').get();
        if (leaderboardMeta.exists && leaderboardMeta.data()?.messageId) {
          const { generateLeaderboardImage } = await import('@/ai/flows/generate-leaderboard-image');
          const image = await generateLeaderboardImage(serverId);
          if (image) {
            const fs = await import('fs/promises');
            const path = await import('path');
            const dir = path.join('/data/clips', 'leaderboard', serverId);
            await fs.mkdir(dir, { recursive: true });
            const files = await fs.readdir(dir);
            for (const f of files) if (f.endsWith('.png')) await fs.unlink(path.join(dir, f)).catch(() => {});
            const base64 = image.replace(/^data:image\/png;base64,/, '');
            const fileName = `leaderboard-${Date.now()}.png`;
            await fs.writeFile(path.join(dir, fileName), Buffer.from(base64, 'base64'));
            const imageUrl = `https://discord-stream-hub-new.fly.dev/api/media/leaderboard/${serverId}/${fileName}`;
            const meta = leaderboardMeta.data()!;
            const botToken = process.env.DISCORD_BOT_TOKEN;
            await fetch(`https://discord.com/api/v10/channels/${meta.channelId}/messages/${meta.messageId}`, {
              method: 'PATCH',
              headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ embeds: [{ title: '\ud83c\udfc6 Community Leaderboard', description: 'Top contributors in the community!', color: 0x667eea, image: { url: imageUrl }, timestamp: new Date().toISOString() }], components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Check My Rank', custom_id: `check_rank_${serverId}`, emoji: { name: '\ud83d\udcca' } }, { type: 2, style: 2, label: 'How Points Work', custom_id: `points_info_${serverId}`, emoji: { name: '\u2753' } }] }] }),
            });
            console.log(`[TwitchPolling] Leaderboard embed updated`);
          }
        }
      } catch (lbError) {
        console.error(`[TwitchPolling] Leaderboard refresh error:`, lbError);
      }

      // Update Chat Tag game state embed
      try {
        const { postOrUpdateGameEmbed } = await import('./chat-tag-service');
        await postOrUpdateGameEmbed(serverId);
        console.log(`[TwitchPolling] Chat Tag embed updated`);
      } catch (chatTagError) {
        console.error(`[TwitchPolling] Chat Tag embed error:`, chatTagError);
      }

      // Periodic orphan sweep — catch any embeds that slipped through delete failures
      try {
        await this.sweepOrphanedMessages(serverId);
      } catch (sweepError) {
        console.error(`[TwitchPolling] Periodic sweep error:`, sweepError);
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
    // Only enforce cooldown if user currently has an active shoutout
    const existingState = await this.getShoutoutState(serverId, discordUserId);
    if (existingState?.messageId && lastShoutout && Date.now() - lastShoutout.getTime() < this.SHOUTOUT_COOLDOWN) {
      return;
    }

    const group = await getUserGroup(serverId, discordUserId);
    
    // Clip fetching is handled by the separate clip-worker.
    // Existing GIFs in /data/clips/{twitchLogin}/ are used at render time.

    const shoutoutChannelId = await this.getChannelForGroup(serverId, group);
    if (!shoutoutChannelId) {
      console.warn(`[TwitchPolling] No channel configured for group ${group}`);
      return;
    }

    const messageId = await sendShoutoutToDiscord({
      serverId,
      channelId: shoutoutChannelId,
      twitchLogin,
      group,
      stream
    });

    if (messageId) {
      await this.saveShoutoutState(serverId, discordUserId, {
        isLive: true,
        messageId,
        channelId: shoutoutChannelId,
        discordUserId,
        twitchLogin,
        group,
        lastUpdated: new Date(),
        currentClipIndex: 0,
        streamStartedAt: new Date()
      });
      
      // If posting to community channel, repost pinned spotlight embed to keep it at bottom
      if (group === 'Honored Guests' || group === 'Everyone Else') {
        await this.repostSpotlightPinnedEmbed(serverId, shoutoutChannelId);
      }

      state.lastShoutouts[twitchLogin] = new Date();
      await this.saveLastShoutout(serverId, twitchLogin, new Date());
      console.log(`[TwitchPolling] ✅ Posted ${group} shoutout for ${twitchLogin} to ${shoutoutChannelId}`);
    } else {
      console.error(`[TwitchPolling] ❌ FAILED to post ${group} shoutout for ${twitchLogin} to channel ${shoutoutChannelId}`);
    }
  }

  private async updateShoutout(serverId: string, discordUserId: string, stream: any, shoutoutState: any): Promise<void> {
    const group = await getUserGroup(serverId, discordUserId);
    const twitchLogin = stream.user_login;
    const { editDiscordMessage } = await import('./discord-sync-service');
    
    let embed;
    let embedsToSend: any[] = [];
    let componentsToSend: any[] | undefined = undefined;
    
    if (group === 'Crew') {
      const { getUserByLogin } = await import('./twitch-api-service');
      const userInfo = await getUserByLogin(twitchLogin);
      const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).get();
      const partnerDiscordLink = userDoc.data()?.partnerDiscordLink || 'https://discord.gg/spacemountain';

      // Increment clip index FIRST
      const newIndex = (shoutoutState.currentClipIndex || 0) + 1;
      await this.saveShoutoutState(serverId, discordUserId, { ...shoutoutState, currentClipIndex: newIndex });
      
      // Then get clip with new index
      const { getCurrentClipForUser } = await import('./clip-rotation-service');
      const clip = await getCurrentClipForUser(serverId, discordUserId);
      const bannerUrl = `https://discord-stream-hub-new.fly.dev/api/media/banners/${twitchLogin.toLowerCase()}.gif?v=${Date.now()}`;
      const fallbackBannerUrl = process.env.CREW_BANNER_GIF_URL || 'https://via.placeholder.com/1920x120/00D9FF/FFFFFF?text=SPACE+MOUNTAIN+CREW';
      const streamThumbnail = stream.thumbnail_url?.replace('{width}', '1920').replace('{height}', '1080');
      const crewImageUrl = clip?.gifUrl || streamThumbnail || fallbackBannerUrl;
      
      // Check if per-user banner exists on disk
      const { existsSync: bannerExists } = await import('fs');
      const { join: joinPath } = await import('path');
      const CLIP_PATH = process.env.STORAGE_PATH || '/data/clips';
      const bannerFilePath = joinPath(CLIP_PATH, 'banners', `${twitchLogin.toLowerCase()}.gif`);
      let resolvedBannerUrl: string;
      if (bannerExists(bannerFilePath)) {
        resolvedBannerUrl = bannerUrl;
      } else {
        resolvedBannerUrl = fallbackBannerUrl;
        // Auto-generate banner for next cycle (single user, won't OOM)
        import('./banner-generation-service').then(({ generateCrewBanners }) =>
          generateCrewBanners([twitchLogin]).catch(err => console.error(`[TwitchPolling] Banner gen failed for ${twitchLogin}:`, err))
        );
      }
      
      const bannerEmbed = {
        image: { url: resolvedBannerUrl },
        color: 0x00D9FF
      };
      
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
        thumbnail: { url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: { url: crewImageUrl },
        footer: { text: 'Twitch • Crew Member Shoutout' },
        timestamp: new Date().toISOString()
      };
      embedsToSend = [bannerEmbed, embed];
      componentsToSend = [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Twitch',
              url: `https://twitch.tv/${twitchLogin}`,
              emoji: { name: '📺' }
            },
            {
              type: 2,
              style: 5,
              label: 'Discord',
              url: partnerDiscordLink,
              emoji: { name: '💬' }
            },
            {
              type: 2,
              style: 2,
              label: 'Schedule',
              custom_id: `show_schedule_${serverId}_${twitchLogin.toLowerCase()}`,
              emoji: { name: '📅' }
            }
          ]
        }
      ];
    } else if (group === 'Partners') {
      const { getUserByLogin } = await import('./twitch-api-service');
      const userInfo = await getUserByLogin(twitchLogin);
      const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).get();
      const partnerDiscordLink = userDoc.data()?.partnerDiscordLink || 'https://discord.gg/spacemountain';
      const fallbackGifUrl = process.env.CREW_BANNER_GIF_URL || 'https://via.placeholder.com/1920x120/00D9FF/FFFFFF?text=SPACE+MOUNTAIN+CREW';
      
      // Increment clip index FIRST
      const newIndex = (shoutoutState.currentClipIndex || 0) + 1;
      await this.saveShoutoutState(serverId, discordUserId, { ...shoutoutState, currentClipIndex: newIndex });
      
      // Then get clip with new index
      const { getNextGifCdnUrl } = await import('./gif-rotation-service');
      const clip = await getNextGifCdnUrl(serverId, discordUserId, twitchLogin);
      
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
        thumbnail: { url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: clip ? { url: clip } : { url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • Space Mountain Partner Shoutout' },
        timestamp: new Date().toISOString()
      };
      embedsToSend = [embed];
      componentsToSend = [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Twitch',
              url: `https://twitch.tv/${twitchLogin}`,
              emoji: { name: '📺' }
            },
            {
              type: 2,
              style: 5,
              label: 'Discord',
              url: partnerDiscordLink,
              emoji: { name: '💬' }
            },
            {
              type: 2,
              style: 2,
              label: 'Schedule',
              custom_id: `show_schedule_${serverId}_${twitchLogin.toLowerCase()}`,
              emoji: { name: '📅' }
            }
          ]
        }
      ];
    } else if (group === 'Honored Guests') {
      const { getUserByLogin } = await import('./twitch-api-service');
      const userInfo = await getUserByLogin(twitchLogin);
      
      // Check if user is in community spotlight
      const spotlightDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('current').get();
      const isSpotlight = spotlightDoc.exists && spotlightDoc.data()?.userId === discordUserId;
      
      let imageUrl = stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080');
      
      // Only get GIF if in spotlight
      if (isSpotlight) {
        const newIndex = (shoutoutState.currentClipIndex || 0) + 1;
        await this.saveShoutoutState(serverId, discordUserId, { ...shoutoutState, currentClipIndex: newIndex });
        
        const { getNextGifCdnUrl } = await import('./gif-rotation-service');
        const clip = await getNextGifCdnUrl(serverId, discordUserId, twitchLogin);
        if (clip) imageUrl = clip;
      }
      
      embed = {
        title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
        description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n\n✨ *Honored Guest*`,
        url: `https://twitch.tv/${twitchLogin}`,
        color: 0xFF8C00,
        thumbnail: { url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: { url: imageUrl },
        footer: { text: isSpotlight ? 'Twitch • ⭐ COMMUNITY SPOTLIGHT ⭐' : 'Twitch • Honored Guest' },
        timestamp: new Date().toISOString()
      };
      embedsToSend = [embed];
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
      embedsToSend = [embed];
    } else {
      // Everyone Else - fetch user profile image and check for GIF/spotlight
      const { getUserByLogin } = await import('./twitch-api-service');
      const userInfo = await getUserByLogin(twitchLogin);
      
      // Check if user is in community spotlight
      const spotlightDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('current').get();
      const isSpotlight = spotlightDoc.exists && spotlightDoc.data()?.userId === discordUserId;
      
      let imageUrl = stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080');
      
      // Only get GIF if in spotlight
      if (isSpotlight) {
        const newIndex = (shoutoutState.currentClipIndex || 0) + 1;
        await this.saveShoutoutState(serverId, discordUserId, { ...shoutoutState, currentClipIndex: newIndex });
        
        const { getNextGifCdnUrl } = await import('./gif-rotation-service');
        const clip = await getNextGifCdnUrl(serverId, discordUserId, twitchLogin);
        if (clip) imageUrl = clip;
      }
      
      embed = {
        title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
        description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
        url: `https://twitch.tv/${twitchLogin}`,
        color: 0x9146FF,
        thumbnail: { url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: { url: imageUrl },
        footer: { text: isSpotlight ? 'Twitch • ⭐ COMMUNITY SPOTLIGHT ⭐' : 'Twitch • Mountaineer Shoutout' },
        timestamp: new Date().toISOString()
      };
      embedsToSend = [embed];
    }
    
    try {
      const messagePayload: any = { embeds: embedsToSend.length > 0 ? embedsToSend : [embed] };
      if (componentsToSend) {
        messagePayload.components = componentsToSend;
      }
      await editDiscordMessage(serverId, shoutoutState.channelId, shoutoutState.messageId, messagePayload);
      
      // Save embed to file storage
      const { setUserEmbed } = await import('./embed-storage');
      await setUserEmbed(serverId, discordUserId, embedsToSend.length > 0 ? embedsToSend[embedsToSend.length - 1] : embed);
      
      console.log(`[TwitchPolling] Updated shoutout for ${stream.user_login}`);
    } catch (error) {
      console.log(`[TwitchPolling] Message gone for ${stream.user_login}, self-healing: reposting...`);
      // Clear old state
      await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
        .collection('shoutoutState').doc('current').delete();
      // Repost as new shoutout
      const twitchLogin = stream.user_login;
      const channelId = await this.getChannelForGroup(serverId, group);
      if (channelId) {
        const { sendShoutout } = await import('./discord-sync-service');
        const messagePayload: any = { embeds: embedsToSend.length > 0 ? embedsToSend : [embed] };
        if (componentsToSend) messagePayload.components = componentsToSend;
        const newMessageId = await sendShoutout(serverId, channelId, messagePayload);
        if (newMessageId) {
          await this.saveShoutoutState(serverId, discordUserId, {
            ...shoutoutState,
            messageId: newMessageId,
            channelId,
            lastUpdated: new Date()
          });
          console.log(`[TwitchPolling] ✅ Self-healed: reposted shoutout for ${twitchLogin} (new msg: ${newMessageId})`);
        } else {
          console.error(`[TwitchPolling] ❌ Self-heal failed: could not repost for ${twitchLogin}`);
        }
      }
    }
  }

  private async deleteShoutout(serverId: string, discordUserId: string, shoutoutState: any): Promise<void> {
    const { deleteDiscordMessage } = await import('./discord-sync-service');
    
    // Delete Discord message first — only clear DB state if Discord delete succeeds or message is already gone
    try {
      await deleteDiscordMessage(serverId, shoutoutState.channelId, shoutoutState.messageId);
    } catch (error: any) {
      // If the message is already gone (404 / MESSAGE_NOT_FOUND), treat as success and clean up state
      const msg = error?.message || '';
      if (msg.includes('404') || msg.includes('MESSAGE_NOT_FOUND')) {
        console.log(`[TwitchPolling] Message already gone for ${discordUserId}, cleaning up state`);
      } else {
        console.error(`[TwitchPolling] Discord delete failed for ${discordUserId}, will retry next cycle`);
        return; // Don't clear DB state — retry next poll
      }
    }
    
    await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
      .collection('shoutoutState').doc('current').delete();

    // Clear cached embed from file storage
    const { clearUserEmbed } = await import('./embed-storage');
    await clearUserEmbed(serverId, discordUserId).catch(err => {
      console.error(`[TwitchPolling] Failed to clear embed cache for ${discordUserId}:`, err);
    });

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
      
      // Map group names to saved channel IDs, with Community -> Everyone Else fallback
      return groupChannels[group] || groupChannels['Everyone Else'] || null;
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
        Object.entries(data.lastShoutouts).forEach(([login, timestamp]: [string, any]) => {
          if (timestamp instanceof Date) lastShoutouts[login] = timestamp;
          else if (timestamp?.toDate) lastShoutouts[login] = timestamp.toDate();
          else if (timestamp?.seconds) lastShoutouts[login] = new Date(timestamp.seconds * 1000);
          else if (typeof timestamp === 'string') lastShoutouts[login] = new Date(timestamp);
          else if (typeof timestamp === 'number') lastShoutouts[login] = new Date(timestamp);
          else lastShoutouts[login] = new Date();
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

  private async getLiveCommunityMembers(serverId: string) {
    const snapshot = await db.collection('servers').doc(serverId).collection('users').get();
    const members = [];
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.group === 'Crew' || data.group === 'Partners') continue;
      
      const shoutoutState = await db.collection('servers').doc(serverId)
        .collection('users').doc(doc.id)
        .collection('shoutoutState').doc('current').get();
      
      if (shoutoutState.exists && shoutoutState.data()?.isLive && data.twitchLogin) {
        members.push({
          discordUserId: doc.id,
          twitchLogin: data.twitchLogin
        });
      }
    }
    
    return members;
  }
  
  private async repostSpotlightPinnedEmbed(serverId: string, channelId: string): Promise<void> {
    try {
      console.log('[TwitchPolling] Reposting spotlight embed after new shoutout...');
      
      // Get current spotlight
      const spotlightDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('current').get();
      if (!spotlightDoc.exists) {
        console.log('[TwitchPolling] No active spotlight to repost');
        return;
      }
      
      const spotlight = spotlightDoc.data();
      if (!spotlight?.twitchLogin || !spotlight?.userId) {
        console.log('[TwitchPolling] Spotlight missing required data');
        return;
      }
      
      // Get fresh stream data
      const stream = await getStreamByLogin(spotlight.twitchLogin);
      if (!stream) {
        console.log('[TwitchPolling] Spotlight user no longer live');
        return;
      }
      
      // Get user data
      const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(spotlight.userId).get();
      if (!userDoc.exists) {
        console.log('[TwitchPolling] Spotlight user not found');
        return;
      }
      
      const member = {
        discordUserId: spotlight.userId,
        twitchLogin: spotlight.twitchLogin,
        group: userDoc.data()?.group || 'Community'
      };
      
      // Call the main update function from community-spotlight-service
      const { manageCommunitySpotlight } = await import('./community-spotlight-service');
      
      // Delete old pinned embed
      const { postDiscordMessage, deleteDiscordMessage } = await import('./discord-sync-service');
      const pinnedDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('pinnedEmbed').get();
      if (pinnedDoc.exists && pinnedDoc.data()?.messageId) {
        await deleteDiscordMessage(serverId, channelId, pinnedDoc.data()!.messageId).catch(() => {});
      }
      
      // Create and post new pinned embed
      const embed = {
        title: '⭐ COMMUNITY SPOTLIGHT ⭐',
        description: `**${stream.user_name}** is featured!\n[Watch Stream](https://twitch.tv/${spotlight.twitchLogin})`,
        color: 0xFFD700,
        thumbnail: spotlight.gifUrl ? { url: spotlight.gifUrl } : { url: stream.thumbnail_url.replace('{width}', '300').replace('{height}', '300') },
        fields: [
          { name: '🎮 Game', value: stream.game_name, inline: true },
          { name: '👥 Viewers', value: stream.viewer_count.toString(), inline: true },
          { name: '🔄 Rotates', value: 'Every 10 min', inline: true }
        ]
      };
      
      const messageId = await postDiscordMessage(serverId, channelId, { 
        embeds: [embed],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                label: '🔗 Link Your Twitch & Get Shoutouts',
                custom_id: 'link_twitch_account'
              }
            ]
          }
        ]
      });
      
      if (messageId) {
        await db.collection('servers').doc(serverId).collection('spotlight').doc('pinnedEmbed').set({
          messageId,
          channelId,
          userId: spotlight.userId,
          updatedAt: new Date()
        });
        console.log('[TwitchPolling] ✅ Reposted spotlight embed');
      }
    } catch (error) {
      console.error('[TwitchPolling] Error reposting spotlight embed:', error);
    }
  }

  private async updateLinkingEmbed(serverId: string): Promise<void> {
    try {
      console.log('[TwitchPolling] Updating linking embed...');
      
      // Get linking embed info
      const linkingDoc = await db.collection('servers').doc(serverId).collection('config').doc('linkingEmbed').get();
      if (!linkingDoc.exists) {
        console.log('[TwitchPolling] No linking embed configured');
        return;
      }
      
      const { messageId, channelId } = linkingDoc.data()!;
      if (!messageId || !channelId) {
        console.log('[TwitchPolling] Linking embed missing messageId or channelId');
        return;
      }
      
      // Try to get current spotlight user first
      const spotlightDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('current').get();
      let showcaseUser = null;
      let showcaseGif = null;
      
      if (spotlightDoc.exists && spotlightDoc.data()?.userId) {
        const spotlightData = spotlightDoc.data()!;
        const userId = spotlightData.userId;
        const twitchLogin = spotlightData.twitchLogin;
        
        // Get fresh GIF URL
        if (twitchLogin) {
          const { getNextGifCdnUrl } = await import('./gif-rotation-service');
          showcaseGif = await getNextGifCdnUrl(serverId, userId, twitchLogin);
        }
        
        const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
        if (userDoc.exists) {
          showcaseUser = { id: userDoc.id, ...userDoc.data() };
        }
      }
      
      // Fallback: get a random linked community member if no spotlight
      if (!showcaseUser) {
        const usersSnapshot = await db.collection('servers').doc(serverId).collection('users')
          .where('twitchLogin', '!=', null)
          .limit(50)
          .get();
        
        const linkedUsers = usersSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((u: any) => u.group === 'Honored Guests' || u.group === 'Everyone Else' || u.group === 'Community');
        
        showcaseUser = linkedUsers.length > 0 
          ? linkedUsers[Math.floor(Math.random() * linkedUsers.length)]
          : null;
      }

      const embed = {
        title: '🚀 Get Featured Stream Shoutouts!',
        description: showcaseUser 
          ? `**[${(showcaseUser as any).username}](https://twitch.tv/${(showcaseUser as any).twitchLogin})** gets automatic shoutouts when they go live!\n\n✨ **You can too!** Link your Twitch account below.`
          : 'Link your Twitch account and get automatic shoutouts when you go live!',
        color: 0x9146FF,
        thumbnail: showcaseGif ? { url: showcaseGif } : ((showcaseUser as any)?.avatarUrl ? { url: (showcaseUser as any).avatarUrl } : undefined),
        fields: [
          { name: '⚡ Instant Shoutouts', value: 'When you go live', inline: true },
          { name: '🔄 Live Updates', value: 'Every 10 minutes', inline: true },
          { name: '👥 Viewer Count', value: 'Always displayed', inline: true },
          { name: '🎮 Game Info', value: 'Auto-updated', inline: true },
          { name: '⭐ Spotlight', value: 'Rotation featured', inline: true },
          { name: '🎬 Pro Embeds', value: 'With your clips', inline: true }
        ],
        footer: {
          text: showcaseUser 
            ? `${(showcaseUser as any).username} is one of our featured streamers • Updates every 10 min`
            : 'Join our community of featured streamers'
        },
        timestamp: new Date().toISOString()
      };
      
      try {
        const { editDiscordMessage } = await import('./discord-sync-service');
        await editDiscordMessage(serverId, channelId, messageId, {
          embeds: [embed],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 1,
                  label: 'Link Twitch Account',
                  custom_id: 'link_twitch_account',
                  emoji: { name: '🔗' }
                }
              ]
            }
          ]
        });
        console.log('[TwitchPolling] ✅ Updated linking embed');
      } catch (editError) {
        console.log('[TwitchPolling] Linking embed message gone, clearing stale config');
        await db.collection('servers').doc(serverId).collection('config').doc('linkingEmbed').delete().catch(() => {});
      }
    } catch (error) {
      console.error('[TwitchPolling] Error updating linking embed:', error);
    }
  }

  private async sweepOrphanedMessages(serverId: string): Promise<void> {
    console.log(`[TwitchPolling] Sweeping orphaned messages for server ${serverId}...`);
    const { deleteDiscordMessage } = await import('./discord-sync-service');
    
    // Get all users with active shoutout state
    const usersSnap = await db.collection('servers').doc(serverId).collection('users').get();
    let orphansFound = 0;
    let cleaned = 0;
    
    // Batch-check who's actually live via chat-tag
    const CHAT_TAG_URL = process.env.CHAT_TAG_URL || 'https://chat-tag-new.fly.dev';
    const allLogins = usersSnap.docs.map(d => d.data().twitchLogin).filter(Boolean);
    const liveLogins = new Set<string>();
    
    try {
      const liveRes = await fetch(`${CHAT_TAG_URL}/api/twitch/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: allLogins }),
      });
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        for (const u of (liveData.liveUsers || [])) {
          liveLogins.add((u.username || u.login || '').toLowerCase());
        }
      }
    } catch (e) {
      console.error('[TwitchPolling] Sweep: failed to fetch live data, skipping sweep');
      return; // Can't determine who's live — don't risk deleting active shoutouts
    }
    
    for (const userDoc of usersSnap.docs) {
      const stateDoc = await db.collection('servers').doc(serverId)
        .collection('users').doc(userDoc.id)
        .collection('shoutoutState').doc('current').get();
      
      if (!stateDoc.exists) continue;
      
      const state = stateDoc.data()!;
      if (!state.messageId || !state.channelId) continue;
      
      const twitchLogin = (state.twitchLogin || userDoc.data().twitchLogin || '').toLowerCase();
      const isActuallyLive = twitchLogin && liveLogins.has(twitchLogin);
      
      if (!isActuallyLive) {
        orphansFound++;
        try {
          await deleteDiscordMessage(serverId, state.channelId, state.messageId);
          await stateDoc.ref.delete();
          
          const { clearUserEmbed } = await import('./embed-storage');
          await clearUserEmbed(serverId, userDoc.id).catch(() => {});
          
          cleaned++;
          console.log(`[TwitchPolling] Sweep: cleaned orphan for ${twitchLogin} (msg: ${state.messageId})`);
        } catch (err) {
          console.error(`[TwitchPolling] Sweep: failed to clean ${twitchLogin}:`, err);
        }
        await this.delay(this.DISCORD_RATE_DELAY);
      }
    }
    
    // Also sweep orphaned spotlight pinned embed
    try {
      const pinnedDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('pinnedEmbed').get();
      if (pinnedDoc.exists) {
        const pinned = pinnedDoc.data()!;
        const spotlightLogin = (await db.collection('servers').doc(serverId).collection('users').doc(pinned.userId || '').get()).data()?.twitchLogin?.toLowerCase();
        if (!spotlightLogin || !liveLogins.has(spotlightLogin)) {
          await deleteDiscordMessage(serverId, pinned.channelId, pinned.messageId).catch(() => {});
          await pinnedDoc.ref.delete();
          console.log(`[TwitchPolling] Sweep: cleaned orphaned spotlight pinned embed`);
          cleaned++;
        }
      }
    } catch (err) {
      console.error('[TwitchPolling] Sweep: spotlight cleanup error:', err);
    }
    
    console.log(`[TwitchPolling] Sweep complete: ${orphansFound} orphans found, ${cleaned} cleaned`);
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

export async function runTwitchPollNow(serverId: string): Promise<void> {
  return twitchPollingService.pollNow(serverId);
}

export async function initializeTwitchPolling(): Promise<void> {
  return twitchPollingService.initialize();
}
