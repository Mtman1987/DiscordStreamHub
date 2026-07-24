import tmi from 'tmi.js';
import { awardPoints } from './points-service';
import { db } from '@/data/server-init';
import { getValidBotAccessToken } from './twitch-oauth-service';
import { getHardcodedAdminTwitchId, getStreamweaverUrl } from './runtime-config';

class TwitchChatService {
  private client: tmi.Client | null = null;
  private serverId: string | null = null;
  private allowedUserIds: Set<string> = new Set();
  private allowedLogins: Set<string> = new Set();
  private status: 'idle' | 'starting' | 'connected' | 'waiting-for-live-channels' | 'disabled' | 'error' = 'idle';
  private joinedChannels: Set<string> = new Set();
  private lastError: string | null = null;
  private lastStartedAt: string | null = null;
  private lastUpdatedAt: string | null = null;
  private lastMessageAt: string | null = null;
  private lastAthenaForwardAt: string | null = null;

  async start(serverId: string) {
    if (this.client) {
      console.log('[TwitchChat] Already running');
      return;
    }

    this.status = 'starting';
    this.lastError = null;
    this.serverId = serverId;
    await this.loadAllowedUsers();

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
    this.client.on('join', (channel) => {
      const normalized = normalizeChannel(channel);
      if (normalized) this.joinedChannels.add(normalized);
    });
    this.client.on('part', (channel) => {
      const normalized = normalizeChannel(channel);
      if (normalized) this.joinedChannels.delete(normalized);
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
      this.joinedChannels = new Set(liveUsers.map(normalizeChannel).filter(Boolean));
      console.log(`[TwitchChat] Monitoring ${liveUsers.length} channels`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[TwitchChat] Connection failed: ${msg} — token may be expired. Re-authorize bot in settings.`);
      this.status = 'error';
      this.lastError = msg;
      this.client = null;
      this.joinedChannels.clear();
    }
  }

  private async loadAllowedUsers() {
    const usersSnapshot = await db.collection('servers').doc(this.serverId!).collection('users').get();
    this.allowedUserIds.clear();
    this.allowedLogins.clear();
    
    usersSnapshot.docs.forEach((doc: { data: () => any }) => {
      const data = doc.data();
      if (data.twitchId) this.allowedUserIds.add(data.twitchId);
      if (data.twitchLogin) this.allowedLogins.add(data.twitchLogin.toLowerCase());
    });
  }

  private async getLiveChannels(): Promise<string[]> {
    const usersSnapshot = await db.collection('servers').doc(this.serverId!).collection('users').get();
    const liveChannels: string[] = [];

    for (const doc of usersSnapshot.docs) {
      const shoutoutState = await doc.ref.collection('shoutoutState').doc('current').get();
      if (shoutoutState.exists && shoutoutState.data()?.isLive) {
        const twitchLogin = doc.data().twitchLogin;
        const channel = normalizeChannel(twitchLogin);
        if (channel) liveChannels.push(channel);
      }
    }

    return liveChannels;
  }

  private async handleMessage(channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) {
    const twitchUserId = String(tags['user-id'] || '');
    const login = String(tags.username || '').toLowerCase();
    const displayName = String(tags['display-name'] || tags.username || '');
    this.lastMessageAt = new Date().toISOString();

    if (self || !twitchUserId || !this.allowedUserIds.has(twitchUserId)) return;

    await awardPoints({
      serverId: this.serverId!,
      userId: twitchUserId,
      eventType: 'chat_activity',
      quantity: 1,
      source: 'twitch',
      metadata: { username: displayName || login, channel }
    });

    await this.maybeForwardAthenaMention(channel, {
      twitchUserId,
      login,
      displayName,
      message,
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
        await this.client.join(channel);
        this.joinedChannels.add(normalized);
        console.log(`[TwitchChat] Joined live Space Mountain channel #${normalized}`);
      }
    }
    
    for (const channel of currentChannels) {
      if (!liveChannels.includes(channel)) {
        await this.client.part(channel);
        this.joinedChannels.delete(channel);
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
    };
  }

  private async maybeForwardAthenaMention(channel: string, input: {
    twitchUserId: string;
    login: string;
    displayName: string;
    message: string;
  }): Promise<void> {
    const adminTwitchId = String(getHardcodedAdminTwitchId() || '').trim();
    const isOwner = Boolean(adminTwitchId && input.twitchUserId === adminTwitchId);
    if (!isOwner) return;
    if (!/\b(?:athena|annie|athenabot87)\b/i.test(input.message)) return;

    const streamweaverSecret = String(process.env.STREAMWEAVER_SECRET || '').trim();
    const streamweaverBase = getStreamweaverUrl().replace(/\/$/, '');
    const tenantId = adminTwitchId;
    const targetChannel = normalizeChannel(channel);
    if (!tenantId || !targetChannel) return;

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
          channelName: targetChannel,
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

      const sendResponse = await fetch(`${streamweaverBase}/api/twitch/send-message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tenantId,
          targetChannel,
          as: 'bot',
          bridgeToDiscord: false,
          message: reply,
        }),
        cache: 'no-store',
      });

      if (!sendResponse.ok) {
        const body = await sendResponse.text().catch(() => '');
        throw new Error(`Twitch send failed: ${sendResponse.status} ${body.slice(0, 200)}`);
      }

      this.lastAthenaForwardAt = new Date().toISOString();
      console.log(`[TwitchChat] Athena forwarded owner mention from ${input.login} in #${targetChannel}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.lastError = `Athena forward failed: ${msg}`;
      console.error('[TwitchChat] Athena forward failed:', error);
    }
  }
}

function normalizeChannel(channel: string): string {
  return String(channel || '').trim().toLowerCase().replace(/^#/, '');
}

export const twitchChatService = new TwitchChatService();
