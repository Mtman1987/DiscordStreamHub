import type { DiscordServer, DiscordMessage, UserProfile } from '@/lib/types';

export const demoServer: DiscordServer = {
  serverId: 'demo-server',
  serverName: 'Galactic Raiders',
  adminRoles: ['Captain', 'Officer', 'Navigator'],
};

export const demoServers: DiscordServer[] = [demoServer];

export const demoSourceChannels = [
  { id: 'general', name: 'general' },
  { id: 'missions', name: 'mission-updates' },
  { id: 'raids', name: 'raid-planning' },
];

export const demoTargetChannels = [
  { id: 'intel', name: 'intel-briefings' },
  { id: 'operations', name: 'operations' },
];

export const demoForwardingRules = [
  {
    id: 'rule-1',
    sourceChannel: 'missions',
    targetServer: 'demo-server',
    targetChannel: 'intel',
  },
  {
    id: 'rule-2',
    sourceChannel: 'raids',
    targetServer: 'demo-server',
    targetChannel: 'operations',
  },
];

export const demoUsers: UserProfile[] = [
  {
    id: 'demo-user-1',
    discordUserId: 'demo-user-1',
    username: 'NovaCommand',
    avatarUrl:
      'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&w=120',
    isOnline: true,
    topic: 'Charting a new raid route.',
    group: 'VIP',
    roles: ['Captain', 'Raid Lead'],
    dailyShoutout: undefined,
    shoutoutGeneratedAt: undefined,
  },
  {
    id: 'demo-user-2',
    discordUserId: 'demo-user-2',
    username: 'StellarScout',
    avatarUrl:
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&w=120',
    isOnline: false,
    topic: 'Scanning deep space channels.',
    group: 'Community',
    roles: ['Navigator'],
    dailyShoutout: undefined,
    shoutoutGeneratedAt: undefined,
  },
  {
    id: 'demo-user-3',
    discordUserId: 'demo-user-3',
    username: 'RaidRunner',
    avatarUrl:
      'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?auto=format&w=120',
    isOnline: true,
    topic: 'Preparing tonight’s raid briefing.',
    group: 'Raid Train',
    roles: ['Officer'],
    dailyShoutout: undefined,
    shoutoutGeneratedAt: undefined,
  },
];

const demoAuthor = {
  name: 'CelestialSage',
  avatar:
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&w=120',
};

export const demoMessages: DiscordMessage[] = [
  {
    id: 'demo-message-1',
    channelId: 'missions',
    userProfileId: 'demo-user-2',
    messageContent:
      "Intel drop incoming! <@demo-user-1> check the new raid route draft. We might need to re-route through sector 7.",
    timestamp: {
      seconds: Math.floor(Date.now() / 1000) - 1800,
      nanoseconds: 0,
      toDate: () => new Date(Date.now() - 1800 * 1000),
    } as any,
    originalAuthor: demoAuthor,
  },
  {
    id: 'demo-message-2',
    channelId: 'raids',
    userProfileId: 'demo-user-3',
    messageContent:
      '⚠️ Raid briefing starts in 30 minutes. Bring your best loadouts and make sure to review the intel doc.',
    timestamp: {
      seconds: Math.floor(Date.now() / 1000) - 7200,
      nanoseconds: 0,
      toDate: () => new Date(Date.now() - 7200 * 1000),
    } as any,
    originalAuthor: demoAuthor,
    reply: {
      text: 'Copy that! I’ll have the squad ready.',
      authorId: 'demo-user-1',
      authorName: 'NovaCommand',
      authorAvatar:
        'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&w=120',
      timestamp: {
        seconds: Math.floor(Date.now() / 1000) - 3600,
        nanoseconds: 0,
        toDate: () => new Date(Date.now() - 3600 * 1000),
      } as any,
    },
  },
  {
    id: 'demo-message-3',
    channelId: 'general',
    userProfileId: 'demo-user-1',
    messageContent:
      'Heads up crew! The raid highlight reel just dropped: https://cdn.pixabay.com/photo/2017/01/31/13/14/space-2024124_960_720.jpg 🚀',
    timestamp: {
      seconds: Math.floor(Date.now() / 1000) - 5400,
      nanoseconds: 0,
      toDate: () => new Date(Date.now() - 5400 * 1000),
    } as any,
    originalAuthor: demoAuthor,
  },
];
