import tmi from 'tmi.js';
import { awardPoints } from './points-service';
import { db } from '@/data/server-init';
import { getValidBotAccessToken } from './twitch-oauth-service';
import { getHardcodedAdminTwitchId, getStreamweaverUrl } from './runtime-config';
import { isExplicitAthenaInvocation } from './athena-visitor-gate';
import { blacklistChatTagChannel, fetchTagData } from './chat-tag-service';
import { sendOwnerDiscordDm } from './owner-dm-service';
import { buildTwitchBanOwnerDm, isTwitchBanNotice, type TwitchBanProfileSnapshot } from './twitch-ban-blacklist';

const ATHENA_OWNER_WINDOW_MS = 10 * 60 * 1000;

type AthenaChannelAccess = {
  ownerWindowUntil: number;
  broadcasterAuthorized: boolean;
  deniedUserIds: Set<string>;
};

class TwitchChatService {
  private client: tmi.Client | null = null;
  private serverId: string | null = null;
  private allowedUserIds: Set<string> = new Set();
  private allowedLogins: Set<string> = new Set();
  private channelBroadcasterIds: Map<string, string> = new Map();
  private athenaHomeChannel: string | null = null;
  private athenaChannelAccess: Map<string, AthenaChannelAccess> = new Map();
  private status: 'idle' | 'starting' | 'connected' | 'waiting-for-live-channels' | 'disabled' | 'error' = 'idle';
  private joinedChannels: Set<string> = new Set();
  private lastError: string | null = null;
  private lastStartedAt: string | null = null;
  private lastUpdatedAt: string | null = null;
  private lastMessageAt: string | null = null;
  private lastAthenaForwardAt: string | null = null;
  private lastAutoBlacklistedChannel: string | null = null;
  private lastAutoBlacklistedAt: string | null = null;
  private blacklistJobs: Map<string, Promise<void>> = new Map();

  async start(serverId: string) {
    if (this.client) {
      console.log('[TwitchChat] Already running');
      return;
    }

    this.status = 'starting';
    this.lastError = null;
    this.serverId = serverId;
    await this.loadAllowedUsers();
    await this.reconcilePendingBlacklists();

    const botConfig = await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').get();
    if (!botConfig.exists || (!botConfig.data()?.accessToken && !botConfig.data()?.refreshToken)) {
      console.warn('[TwitchChat] Bot OAuth not configured — chat monitoring disabled. Re-authorize bot in settings.');
      this.status = 'disabled';
      this.lastError = 'Bot OAuth not configured';
      return;
    }

    const { botUsername } = botConfig.data()!;
    const validAccessToken = await getValidBotAccessToken(serverId);
    if (!validAccessToken) {
      console.warn('[TwitchChat] Bot OAuth could not be refreshed — chat monitoring disabled. Re-authorize bot in settings.');
      this.status = 'disabled';
      this.lastError = 'Bot OAuth could not be refreshed';
      return;
    }
    const liveUsers = await this.getLiveChannels();
    if (liveUsers.length === 0) {
      console.log('[TwitchChat] No live channels to monitor');
      this.status = 'waiting-for-live-channels';
      this.joinedChannels.clear();
      return;
    }

    this.client = new tmi.Client({
      options: { debug: false },
      identity: {
        username: botUsername,
        password: `oauth:${validAccessToken}`,
      },
      channels: liveUsers,
    });

    this.client.on('message', this.handleMessage.bind(this));
    this.client.on('subscription', this.handleSub.bind(this));
    this.client.on('subgift', this.handleGiftSub.bind(this));
    this.client.on('cheer', this.handleCheer.bind(this));
    this.client.on('raided', this.handleRaid.bind(this));
    this.client.on('notice', (channel, messageId, message) => {
      if (!isTwitchBanNotice(messageId, message)) return;
      void this.handleBannedChannel(channel, `${messageId}: ${message}`).catch((error) => {
        console.error('[TwitchChat] Automatic blacklist failed:', error);
      });
    });
    this.client.on('join', (channel) => {
      const normalized = normalizeChannel(channel);
      if (normalized) this.joinedChannels.add(normalized);
    });
    this.client.on('part', (channel) => {
      const normalized = normalizeChannel(channel);
      if (normalized) {
        this.joinedChannels.delete(normalized);
        this.athenaChannelAccess.delete(normalized);
      }
    });
    this.client.on('disconnected', (reason) => {
      this.status = 'error';
      this.lastError = `Disconnected: ${reason}`;
      this.client = null;
      this.joinedChannels.clear();
      console.warn(`[TwitchChat] Disconnected: ${reason}`);
    });

    try {
      await this.client.connect();
      this.status = 'connected';
      this.lastStartedAt = new Date().toISOString();
      this.joinedChannels = new Set(this.client.getChannels().map(normalizeChannel).filter(Boolean));
      console.log(`[TwitchChat] Monitoring ${this.joinedChannels.size} channels`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTwitchBanNotice(msg, msg)) {
        if (this.blacklistJobs.size === 0 && liveUsers.length === 1) {
          await this.handleBannedChannel(liveUsers[0], msg);
        } else {
          await Promise.allSettled(Array.from(this.blacklistJobs.values()));
        }
        console.warn(`[TwitchChat] Connection excluded a channel that permanently banned the bot: ${msg}`);
        this.status = 'waiting-for-live-channels';
        this.lastError = null;
        this.client = null;
        this.joinedChannels.clear();
        return;
      }
      console.warn(`[TwitchChat] Connection failed: ${msg} — token may be expired. Re-authorize bot in settings.`);
      this.status = 'error';
      this.lastError = msg;
      this.client = null;
      this.joinedChannels.clear();
    }
  }

  private async loadAllowedUsers() {
    const usersSnapshot = await db.collection('servers').doc(this.serverId!).collection('users').get();
    const blacklistedChannels = await this.getBlacklistedChannels();
    this.allowedUserIds.clear();
    this.allowedLogins.clear();
    this.channelBroadcasterIds.clear();
    this.athenaHomeChannel = null;
    const adminTwitchId = String(getHardcodedAdminTwitchId() || '').trim();

    usersSnapshot.docs.forEach((doc: { data: () => any }) => {
      const data = doc.data();
      const twitchId = String(data.twitchId || '').trim();
      const twitchLogin = normalizeChannel(data.twitchLogin);
      if (twitchLogin && blacklistedChannels.has(twitchLogin)) return;
      if (twitchId) this.allowedUserIds.add(twitchId);
      if (twitchLogin) this.allowedLogins.add(twitchLogin);
      if (twitchId && twitchLogin) this.channelBroadcasterIds.set(twitchLogin, twitchId);
      if (adminTwitchId && twitchId === adminTwitchId && twitchLogin) {
        this.athenaHomeChannel = twitchLogin;
      }
    });
  }

  private async getLiveChannels(): Promise<string[]> {
    const usersSnapshot = await db.collection('servers').doc(this.serverId!).collection('users').get();
    const blacklistedChannels = await this.getBlacklistedChannels();
    const liveChannels: string[] = [];

    for (const doc of usersSnapshot.docs) {
      const shoutoutState = await doc.ref.collection('shoutoutState').doc('current').get();
      if (shoutoutState.exists && shoutoutState.data()?.isLive) {
        const twitchLogin = doc.data().twitchLogin;
        const channel = normalizeChannel(twitchLogin);
        if (channel && !blacklistedChannels.has(channel)) liveChannels.push(channel);
      }
    }

    return liveChannels;
  }

  private async handleMessage(channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) {
    const twitchUserId = String(tags['user-id'] || '');
    const login = String(tags.username || '').toLowerCase();
    const displayName = String(tags['display-name'] || tags.username || '');
    const targetChannel = normalizeChannel(channel);
    this.lastMessageAt = new Date().toISOString();

    if (self || !twitchUserId || !targetChannel) return;

    const isSpmtMember = this.allowedUserIds.has(twitchUserId);
    if (isSpmtMember) {
      await awardPoints({
        serverId: this.serverId!,
        userId: twitchUserId,
        eventType: 'chat_activity',
        quantity: 1,
        source: 'twitch',
        metadata: { username: displayName || login, channel: targetChannel }
      });
    }

    await this.maybeHandleAthenaVisitorMessage(targetChannel, {
      twitchUserId,
      login,
      displayName,
      message,
      isSpmtMember,
    });
  }

  private async handleSub(channel: string, username: string, method: tmi.SubMethods, message: string, userstate: tmi.SubUserstate) {
    const userId = userstate['user-id'];
    if (!userId || !this.allowedUserIds.has(userId)) return;

    await awardPoints({
      serverId: this.serverId!,
      userId,
      eventType: 'subscription',
      quantity: 1,
      source: 'twitch',
      metadata: { username, channel }
    });
  }

  private async handleGiftSub(channel: string, username: string, streakMonths: number, recipient: string, methods: tmi.SubMethods, userstate: tmi.SubGiftUserstate) {
    const userId = userstate['user-id'];
    if (!userId || !this.allowedUserIds.has(userId)) return;

    await awardPoints({
      serverId: this.serverId!,
      userId,
      eventType: 'gifted_subscription',
      quantity: 1,
      source: 'twitch',
      metadata: { username, channel, recipient }
    });
  }

  private async handleCheer(channel: string, userstate: tmi.ChatUserstate, message: string) {
    const userId = userstate['user-id'];
    const bits = parseInt(userstate.bits || '0');
    if (!userId || bits === 0 || !this.allowedUserIds.has(userId)) return;

    await awardPoints({
      serverId: this.serverId!,
      userId,
      eventType: 'bits',
      quantity: bits,
      source: 'twitch',
      metadata: { username: userstate['display-name'] || userstate.username, channel, bits }
    });
  }

  private async handleRaid(channel: string, username: string, viewers: number) {
    const raiderLogin = username.toLowerCase();
    const targetChannel = channel.replace('#', '').toLowerCase();
    
    if (!this.allowedLogins.has(raiderLogin) || !this.allowedLogins.has(targetChannel)) return;

    const usersSnapshot = await db.collection('servers').doc(this.serverId!).collection('users')
      .where('twitchLogin', '==', raiderLogin).limit(1).get();

    if (usersSnapshot.empty) return;

    const raiderId = usersSnapshot.docs[0].data().twitchId || usersSnapshot.docs[0].id;

    await awardPoints({
      serverId: this.serverId!,
      userId: raiderId,
      eventType: 'raid',
      quantity: 1,
      source: 'twitch',
      metadata: { username, channel, viewers, targetChannel }
    });
  }

  async updateChannels(serverId?: string) {
    if (serverId && this.serverId !== serverId) {
      this.serverId = serverId;
    }
    this.lastUpdatedAt = new Date().toISOString();
    await this.reconcilePendingBlacklists();
    const liveChannels = await this.getLiveChannels();
    if (!this.client) {
      if (liveChannels.length > 0 && this.serverId) {
        console.log(`[TwitchChat] Client not connected; starting for ${liveChannels.length} live channel(s)`);
        await this.start(this.serverId);
      } else {
        this.status = 'waiting-for-live-channels';
        this.joinedChannels.clear();
      }
      return;
    }

    await this.loadAllowedUsers();
    const currentChannels = this.client.getChannels().map(c => normalizeChannel(c)).filter(Boolean);
    
    for (const channel of liveChannels) {
      const normalized = normalizeChannel(channel);
      if (normalized && !currentChannels.includes(normalized)) {
        try {
          await this.client.join(channel);
          this.joinedChannels.add(normalized);
          console.log(`[TwitchChat] Joined live Space Mountain channel #${normalized}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isTwitchBanNotice(message, message)) {
            await this.handleBannedChannel(normalized, message);
            continue;
          }
          throw error;
        }
      }
    }
    
    for (const channel of currentChannels) {
      if (!liveChannels.includes(channel)) {
        await this.client.part(channel);
        this.joinedChannels.delete(channel);
        this.athenaChannelAccess.delete(channel);
        console.log(`[TwitchChat] Parted offline Space Mountain channel #${channel}`);
      }
    }
  }

  async stop() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.status = 'idle';
    this.joinedChannels.clear();
    this.athenaChannelAccess.clear();
  }

  getStatus() {
    return {
      status: this.status,
      serverId: this.serverId,
      connected: Boolean(this.client),
      joinedChannels: Array.from(this.joinedChannels).sort(),
      joinedChannelCount: this.joinedChannels.size,
      allowedUserCount: this.allowedUserIds.size,
      allowedLoginCount: this.allowedLogins.size,
      lastError: this.lastError,
      lastStartedAt: this.lastStartedAt,
      lastUpdatedAt: this.lastUpdatedAt,
      lastMessageAt: this.lastMessageAt,
      lastAthenaForwardAt: this.lastAthenaForwardAt,
      lastAutoBlacklistedChannel: this.lastAutoBlacklistedChannel,
      lastAutoBlacklistedAt: this.lastAutoBlacklistedAt,
      athenaHomeChannel: this.athenaHomeChannel,
      activeAthenaVisitorChannels: Array.from(this.athenaChannelAccess.entries())
        .filter(([, access]) => access.broadcasterAuthorized || access.ownerWindowUntil > Date.now())
        .map(([channel]) => channel)
        .sort(),
    };
  }

  private async maybeHandleAthenaVisitorMessage(channel: string, input: {
    twitchUserId: string;
    login: string;
    displayName: string;
    message: string;
    isSpmtMember: boolean;
  }): Promise<void> {
    // Streamweaver already owns Athena in her normal tenant channel.
    if (channel === this.athenaHomeChannel) return;

    const broadcasterId = this.channelBroadcasterIds.get(channel);
    const isBroadcaster = Boolean(broadcasterId && input.twitchUserId === broadcasterId);
    const normalizedMessage = input.message.trim().toLowerCase();

    if (normalizedMessage === '!spmt') {
      if (!isBroadcaster) return;
      const access = this.getAthenaAccess(channel);
      access.broadcasterAuthorized = true;
      access.deniedUserIds.clear();
      await this.sayInChannel(
        channel,
        `Athena is available for the rest of this stream at ${input.displayName || input.login}'s request.`,
      );
      console.log(`[TwitchChat] Broadcaster authorized Athena for #${channel}`);
      return;
    }

    if (!isExplicitAthenaInvocation(input.message)) return;

    const adminTwitchId = String(getHardcodedAdminTwitchId() || '').trim();
    const isOwner = Boolean(adminTwitchId && input.twitchUserId === adminTwitchId);
    const access = this.getAthenaAccess(channel);
    const now = Date.now();

    if (isOwner) {
      access.ownerWindowUntil = now + ATHENA_OWNER_WINDOW_MS;
      access.deniedUserIds.clear();
    }

    const ownerWindowOpen = access.ownerWindowUntil > now;
    const mayRespond = isOwner
      || access.broadcasterAuthorized
      || (ownerWindowOpen && input.isSpmtMember);
    if (!mayRespond) {
      if (ownerWindowOpen && !input.isSpmtMember && !access.deniedUserIds.has(input.twitchUserId)) {
        access.deniedUserIds.add(input.twitchUserId);
        await this.sayInChannel(
          channel,
          `Sorry—while visiting ${channel}'s chat, I can only answer Space Mountain members without the streamer's express permission.`,
        );
      }
      return;
    }

    await this.forwardAthenaMessage(channel, input);
  }

  private getAthenaAccess(channel: string): AthenaChannelAccess {
    const existing = this.athenaChannelAccess.get(channel);
    if (existing) return existing;
    const created: AthenaChannelAccess = {
      ownerWindowUntil: 0,
      broadcasterAuthorized: false,
      deniedUserIds: new Set(),
    };
    this.athenaChannelAccess.set(channel, created);
    return created;
  }

  private async sayInChannel(channel: string, message: string): Promise<void> {
    if (!this.client || !this.joinedChannels.has(channel)) return;
    await this.client.say(`#${channel}`, message);
  }

  private async forwardAthenaMessage(channel: string, input: {
    twitchUserId: string;
    login: string;
    displayName: string;
    message: string;
  }): Promise<void> {
    const streamweaverSecret = String(process.env.STREAMWEAVER_SECRET || '').trim();
    const streamweaverBase = getStreamweaverUrl().replace(/\/$/, '');
    const tenantId = String(getHardcodedAdminTwitchId() || '').trim();
    if (!tenantId) return;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (streamweaverSecret) headers.Authorization = `Bearer ${streamweaverSecret}`;

    try {
      const aiResponse = await fetch(`${streamweaverBase}/api/ai/chat-with-memory`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tenantId,
          username: input.login,
          userId: input.twitchUserId,
          displayName: input.displayName || input.login,
          message: input.message,
          channelName: channel,
          channelType: 'visitor-channel',
          context: 'twitch-cross-bot',
          responseName: 'Athena',
        }),
        cache: 'no-store',
      });

      if (!aiResponse.ok) {
        const body = await aiResponse.text().catch(() => '');
        throw new Error(`AI response failed: ${aiResponse.status} ${body.slice(0, 200)}`);
      }

      const data = await aiResponse.json().catch(() => null);
      const reply = String(data?.response || data?.message || '').trim();
      if (!reply) return;

      await this.sayInChannel(channel, reply);
      this.lastAthenaForwardAt = new Date().toISOString();
      console.log(`[TwitchChat] Athena visitor reply sent for ${input.login} in #${channel}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.lastError = `Athena forward failed: ${msg}`;
      console.error('[TwitchChat] Athena forward failed:', error);
    }
  }

  private blacklistCollection() {
    return db.collection('servers').doc(this.serverId!).collection('twitchChatBlacklist');
  }

  private async getBlacklistedChannels(): Promise<Set<string>> {
    if (!this.serverId) return new Set();
    const snapshot = await this.blacklistCollection().get();
    return new Set(
      snapshot.docs
        .map((doc: { id: string; data: () => any }) => normalizeChannel(doc.data()?.channel || doc.id))
        .filter(Boolean),
    );
  }

  private async handleBannedChannel(channel: string, detail: string): Promise<void> {
    const normalized = normalizeChannel(channel);
    if (!normalized || !this.serverId) return;

    const active = this.blacklistJobs.get(normalized);
    if (active) return active;

    const job = this.persistAndFinishBlacklist(normalized, detail)
      .finally(() => this.blacklistJobs.delete(normalized));
    this.blacklistJobs.set(normalized, job);
    return job;
  }

  private async persistAndFinishBlacklist(channel: string, detail: string): Promise<void> {
    const ref = this.blacklistCollection().doc(channel);
    const snapshot = await ref.get();
    const now = new Date().toISOString();
    await ref.set({
      channel,
      reason: 'twitch-msg-banned',
      noticeDetail: String(detail || 'msg_banned').slice(0, 500),
      firstDetectedAt: snapshot.data()?.firstDetectedAt || now,
      lastDetectedAt: now,
      permanent: true,
    }, { merge: true });

    this.joinedChannels.delete(channel);
    this.athenaChannelAccess.delete(channel);
    this.allowedLogins.delete(channel);
    const broadcasterId = this.channelBroadcasterIds.get(channel);
    if (broadcasterId) this.allowedUserIds.delete(broadcasterId);
    this.channelBroadcasterIds.delete(channel);
    this.lastAutoBlacklistedChannel = channel;
    this.lastAutoBlacklistedAt = now;

    if (this.client) {
      await this.client.part(`#${channel}`).catch(() => undefined);
    }

    console.warn(`[TwitchChat] Permanently blacklisted #${channel} after msg_banned`);
    await this.finishBlacklist(channel);
  }

  private async reconcilePendingBlacklists(): Promise<void> {
    if (!this.serverId) return;
    const snapshot = await this.blacklistCollection().get();
    for (const doc of snapshot.docs as Array<{ id: string; data: () => any }>) {
      const channel = normalizeChannel(doc.data()?.channel || doc.id);
      const data = doc.data() || {};
      if (!channel || (data.streamweaverSyncedAt && data.chatTagSyncedAt && data.notificationSentAt)) continue;
      if (this.blacklistJobs.has(channel)) continue;

      const job = this.finishBlacklist(channel).finally(() => this.blacklistJobs.delete(channel));
      this.blacklistJobs.set(channel, job);
      await job;
    }
  }

  private async finishBlacklist(channel: string): Promise<void> {
    const ref = this.blacklistCollection().doc(channel);
    let record = (await ref.get()).data() || {};
    let profile = record.profileSnapshot as TwitchBanProfileSnapshot | undefined;

    if (!profile) {
      profile = await this.collectProfileSnapshot(channel);
      await ref.set({ profileSnapshot: profile }, { merge: true });
    }

    const errors: string[] = [];
    if (!record.streamweaverSyncedAt) {
      try {
        await this.blacklistInStreamweaver(channel);
        await ref.set({ streamweaverSyncedAt: new Date().toISOString() }, { merge: true });
      } catch (error) {
        errors.push(`StreamWeaver: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!record.chatTagSyncedAt) {
      try {
        await blacklistChatTagChannel(channel);
        await ref.set({ chatTagSyncedAt: new Date().toISOString() }, { merge: true });
      } catch (error) {
        errors.push(`Chat Tag: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    record = (await ref.get()).data() || {};
    if (record.streamweaverSyncedAt && record.chatTagSyncedAt && !record.notificationSentAt) {
      try {
        const delivery = await sendOwnerDiscordDm({ message: buildTwitchBanOwnerDm(profile) });
        await ref.set({
          notificationSentAt: new Date().toISOString(),
          notificationMessageId: delivery.messageId,
        }, { merge: true });
      } catch (error) {
        errors.push(`Owner DM: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      const lastSyncError = errors.join(' | ').slice(0, 1000);
      await ref.set({ lastSyncError, lastSyncAttemptAt: new Date().toISOString() }, { merge: true });
      this.lastError = `Blacklist synchronization pending for #${channel}: ${lastSyncError}`;
      console.warn(`[TwitchChat] ${this.lastError}`);
      return;
    }

    await ref.set({ lastSyncError: null, completedAt: new Date().toISOString() }, { merge: true });
    if (this.lastError?.startsWith('Blacklist synchronization pending')) this.lastError = null;
  }

  private async blacklistInStreamweaver(channel: string): Promise<void> {
    const secret = String(process.env.STREAMWEAVER_SECRET || process.env.DSH_SERVICE_SECRET || '').trim();
    const tenantId = String(getHardcodedAdminTwitchId() || '').trim();
    if (!secret) throw new Error('STREAMWEAVER_SECRET is not configured.');
    if (!tenantId) throw new Error('Owner Twitch tenant ID is not configured.');

    const response = await fetch(`${getStreamweaverUrl().replace(/\/$/, '')}/api/internal/known-bots`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: channel, tenantId, source: 'twitch-msg-banned' }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error || `StreamWeaver blacklist returned ${response.status}`);
    }
  }

  private async collectProfileSnapshot(channel: string): Promise<TwitchBanProfileSnapshot> {
    const usersSnapshot = await db.collection('servers').doc(this.serverId!).collection('users').get();
    const userDoc = usersSnapshot.docs.find((doc: { data: () => any }) => {
      return normalizeChannel(doc.data()?.twitchLogin) === channel;
    });
    const user = userDoc?.data() || {};
    const discordUserId = String(userDoc?.id || user.discordUserId || '').trim();
    const activity = user.discordActivity || {};
    const tagData = await fetchTagData().catch(() => null);
    const player = Array.isArray(tagData?.players)
      ? tagData.players.find((candidate: any) => normalizeChannel(candidate?.twitchUsername || candidate?.username) === channel)
      : null;
    const chatTagJoinedAt = player?.joinedAt || this.findChatTagJoinDate(tagData?.adminHistory, channel);
    const discordJoinedAt = user.discordJoinedAt
      || await this.fetchDiscordJoinDate(discordUserId).catch(() => null);
    const lastPlayedValue = player?.lastPlayedAt || player?.lastChatAt || activity.lastSeenAt || null;
    const lastPlayedAt = typeof lastPlayedValue === 'number'
      ? new Date(lastPlayedValue).toISOString()
      : lastPlayedValue;

    return {
      channel,
      displayName: user.displayName || user.username || player?.displayName || player?.twitchUsername || channel,
      twitchId: String(user.twitchId || this.channelBroadcasterIds.get(channel) || '').trim() || null,
      discordUserId: discordUserId || null,
      chatTagJoinedAt: chatTagJoinedAt || null,
      discordJoinedAt: discordJoinedAt || null,
      firstSeenAt: activity.firstSeenAt || null,
      lastPlayedAt: lastPlayedAt || null,
      daysPlayed: this.numberOrNull(player?.daysPlayed ?? activity.activeDays),
      tags: this.numberOrNull(player?.tags),
      tagged: this.numberOrNull(player?.tagged),
    };
  }

  private findChatTagJoinDate(adminHistory: unknown, channel: string): string | null {
    if (!Array.isArray(adminHistory)) return null;
    const matches = adminHistory
      .filter((entry: any) => String(entry?.action || '').toLowerCase() === 'join')
      .filter((entry: any) => {
        const details = String(entry?.details || '').trim().toLowerCase();
        const actor = normalizeChannel(entry?.performedBy);
        return actor === channel || details.startsWith(`${channel} joined the game`);
      })
      .map((entry: any) => new Date(entry?.timestamp).getTime())
      .filter((timestamp: number) => Number.isFinite(timestamp));
    return matches.length > 0 ? new Date(Math.min(...matches)).toISOString() : null;
  }

  private async fetchDiscordJoinDate(discordUserId: string): Promise<string | null> {
    const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
    if (!botToken || !this.serverId || !discordUserId) return null;
    const response = await fetch(`https://discord.com/api/v10/guilds/${this.serverId}/members/${discordUserId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const member = await response.json().catch(() => null);
    return String(member?.joined_at || '').trim() || null;
  }

  private numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

}

function normalizeChannel(channel: string): string {
  return String(channel || '').trim().toLowerCase().replace(/^#/, '');
}

export const twitchChatService = new TwitchChatService();
