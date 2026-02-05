import tmi from 'tmi.js';
import { awardPoints } from './points-service';
import { db } from '@/firebase/server-init';

class TwitchChatService {
  private client: tmi.Client | null = null;
  private serverId: string | null = null;
  private allowedUserIds: Set<string> = new Set();
  private allowedLogins: Set<string> = new Set();

  async start(serverId: string) {
    if (this.client) {
      console.log('[TwitchChat] Already running');
      return;
    }

    this.serverId = serverId;
    await this.loadAllowedUsers();

    const botConfig = await db.collection('servers').doc(serverId).collection('config').doc('twitchBotOAuth').get();
    if (!botConfig.exists) {
      throw new Error('Bot OAuth not configured');
    }

    const { botUsername, accessToken } = botConfig.data()!;
    const liveUsers = await this.getLiveChannels();

    this.client = new tmi.Client({
      options: { debug: false },
      identity: {
        username: botUsername,
        password: `oauth:${accessToken}`,
      },
      channels: liveUsers,
    });

    this.client.on('message', this.handleMessage.bind(this));
    this.client.on('subscription', this.handleSub.bind(this));
    this.client.on('subgift', this.handleGiftSub.bind(this));
    this.client.on('cheer', this.handleCheer.bind(this));
    this.client.on('raided', this.handleRaid.bind(this));

    await this.client.connect();
    console.log(`[TwitchChat] Monitoring ${liveUsers.length} channels`);
  }

  private async loadAllowedUsers() {
    const usersSnapshot = await db.collection('servers').doc(this.serverId!).collection('users').get();
    this.allowedUserIds.clear();
    this.allowedLogins.clear();
    
    usersSnapshot.docs.forEach(doc => {
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
        if (twitchLogin) liveChannels.push(twitchLogin);
      }
    }

    return liveChannels;
  }

  private async handleMessage(channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) {
    if (self || !tags['user-id'] || !this.allowedUserIds.has(tags['user-id'])) return;

    await awardPoints({
      serverId: this.serverId!,
      userId: tags['user-id'],
      eventType: 'chat_activity',
      quantity: 1,
      source: 'twitch',
      metadata: { username: tags['display-name'] || tags.username, channel }
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

  async updateChannels() {
    if (!this.client) return;
    
    const liveChannels = await this.getLiveChannels();
    const currentChannels = this.client.getChannels().map(c => c.replace('#', ''));
    
    for (const channel of liveChannels) {
      if (!currentChannels.includes(channel)) {
        await this.client.join(channel);
      }
    }
    
    for (const channel of currentChannels) {
      if (!liveChannels.includes(channel)) {
        await this.client.part(channel);
      }
    }
  }

  async stop() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }
}

export const twitchChatService = new TwitchChatService();
