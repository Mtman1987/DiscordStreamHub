// Shared by Next.js server code and standalone Node/tsx workers.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type RuntimeConfig = {
  publicUrls: Record<string, string>;
  publicIds: Record<string, string>;
  publicText: Record<string, string>;
  publicNumbers: Record<string, number>;
  publicFlags: Record<string, string | boolean | number>;
};

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  publicUrls: {
    appUrl: 'https://discord-stream-hub-new.fly.dev',
    baseUrl: 'https://discord-stream-hub-new.fly.dev',
    chatTagApiBase: 'https://chat-tag-new.fly.dev',
    chatTagBotUrl: 'https://chat-tag-bot-new.fly.dev',
    hearmeoutUrl: 'https://hearmeout-main.fly.dev',
    streamweaverUrl: 'https://streamweaver-new.fly.dev',
    discordInviteUrl: 'https://discord.gg/spacemountain',
    clipWorkerUrl: 'https://dsh-clip-worker.fly.dev',
    crewBannerGifUrl: 'https://via.placeholder.com/1920x120/00D9FF/FFFFFF?text=SPACE+MOUNTAIN+CREW',
    livekitUrl: 'wss://streamweaver-7atx04ct.livekit.cloud',
  },
  publicIds: {
    twitchClientId: 'rxmohc28tthq0nudfd6iwx0sgy88dp',
    discordClientId: '1279582181768957963',
    discordActivityApplicationId: '1279582181768957963',
    discordActivityVoiceChannelId: '',
    raidPileChannelId: '',
    hardcodedGuildId: '1240832965865635881',
    hardcodedAdminDiscordId: '767875979561009173',
    hardcodedAdminTwitchId: '94371378',
    chatTagChannelId: '1463633163673927732',
    discordShoutoutChannelId: '',
    gifStorageChannelId: '1341552730971443293',
  },
  publicText: {
    chatTagWebhookName: 'Chat Tag',
    chatTagAvatarUrl: '',
    spaceMountainIconUrl: '',
    discordPublicKey: '',
    storagePath: '/data/clips',
    puppeteerExecutablePath: '',
    databaseFilePath: '/data/app.db',
    discordVoiceBridgeRoomId: 'discord-activity',
  },
  publicNumbers: {
    pointsTwitchFollow: 25,
    pointsTwitchSub: 100,
    pointsTwitchBits: 1,
    pointsTwitchRaid: 50,
    pointsTwitchHost: 30,
    pointsStreamAttendance: 10,
    pointsDiscordMessage: 1,
    pointsDiscordReaction: 2,
    pointsDiscordVoiceMinute: 5,
    pointsDiscordHelpReaction: 10,
    pointsCommunityHelp: 50,
    pointsDailyBonus: 20,
    raidPilePointsReward: 25,
    raidPileMaxSize: 40,
    raidPileMinSize: 10,
  },
  publicFlags: {
    discordChatHandleWatch: true,
    discordDebugEnvLogs: false,
    discordWatchVoiceBot: true,
  },
};

function getDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.FLY_VOLUME_PATH) return process.env.FLY_VOLUME_PATH;
  if (process.env.NEXT_PHASE === 'phase-production-build') return join(process.cwd(), 'data');
  if (process.env.NODE_ENV === 'production' && existsSync('/data')) return '/data';
  return join(process.cwd(), 'data');
}

function getRuntimeConfigPath(): string {
  return join(getDataDir(), 'runtime-config.json');
}

function getLegacyRuntimeConfigPath(): string {
  return join(process.cwd(), 'data', 'runtime-config.json');
}

function ensureRuntimeConfigFile(): void {
  const dir = getDataDir();
  const runtimeConfigPath = getRuntimeConfigPath();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (!existsSync(runtimeConfigPath)) {
    const legacyPath = getLegacyRuntimeConfigPath();
    if (legacyPath !== runtimeConfigPath && existsSync(legacyPath)) {
      writeFileSync(runtimeConfigPath, readFileSync(legacyPath, 'utf8'), 'utf8');
      return;
    }
  }

  if (!existsSync(runtimeConfigPath)) {
    writeFileSync(runtimeConfigPath, JSON.stringify(DEFAULT_RUNTIME_CONFIG, null, 2), 'utf8');
  }
}

function readRuntimeConfig(): RuntimeConfig {
  try {
    ensureRuntimeConfigFile();
    const runtimeConfigPath = getRuntimeConfigPath();
    const raw = readFileSync(runtimeConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
    return {
      publicUrls: { ...DEFAULT_RUNTIME_CONFIG.publicUrls, ...(parsed.publicUrls || {}) },
      publicIds: { ...DEFAULT_RUNTIME_CONFIG.publicIds, ...(parsed.publicIds || {}) },
      publicText: { ...DEFAULT_RUNTIME_CONFIG.publicText, ...(parsed.publicText || {}) },
      publicNumbers: { ...DEFAULT_RUNTIME_CONFIG.publicNumbers, ...(parsed.publicNumbers || {}) },
      publicFlags: { ...DEFAULT_RUNTIME_CONFIG.publicFlags, ...(parsed.publicFlags || {}) },
    };
  } catch (error) {
    console.warn('[RuntimeConfig] Failed to read runtime-config.json; using defaults:', error);
    return structuredClone(DEFAULT_RUNTIME_CONFIG);
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function readEnvFirst(envKeys: string[], fallback: string): string {
  if (!isProduction()) {
    for (const key of envKeys) {
      const value = process.env[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return fallback;
}

function readEnvNumber(envKeys: string[], fallback: number): number {
  if (!isProduction()) {
    for (const key of envKeys) {
      const value = process.env[key];
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value.trim());
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
  }
  return fallback;
}

export function getRuntimePublicUrl(key: keyof RuntimeConfig['publicUrls']): string {
  const config = readRuntimeConfig();
  return readEnvFirst(
    {
      appUrl: ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'APP_URL', 'PUBLIC_BASE_URL'],
      baseUrl: ['NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL', 'PUBLIC_BASE_URL', 'APP_URL'],
      chatTagApiBase: ['CHAT_TAG_API_BASE'],
      chatTagBotUrl: ['CHAT_TAG_BOT_URL'],
      hearmeoutUrl: ['HEARMEOUT_URL'],
      streamweaverUrl: ['STREAMWEAVER_URL', 'STREAMWEAVE_URL'],
      discordInviteUrl: ['DISCORD_INVITE_URL', 'NEXT_PUBLIC_DISCORD_INVITE_URL'],
      clipWorkerUrl: ['CLIP_WORKER_URL'],
      crewBannerGifUrl: ['CREW_BANNER_GIF_URL'],
    }[key] || [],
    config.publicUrls[key] || DEFAULT_RUNTIME_CONFIG.publicUrls[key] || ''
  );
}

export function getRuntimePublicId(key: keyof RuntimeConfig['publicIds']): string {
  const config = readRuntimeConfig();
  return readEnvFirst(
    {
      twitchClientId: ['NEXT_PUBLIC_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_ID'],
      discordClientId: ['NEXT_PUBLIC_DISCORD_CLIENT_ID', 'DISCORD_CLIENT_ID', 'DISCORD_APP_ID'],
      discordActivityApplicationId: ['DISCORD_ACTIVITY_APPLICATION_ID', 'DISCORD_APP_ID', 'DISCORD_CLIENT_ID', 'NEXT_PUBLIC_DISCORD_CLIENT_ID'],
      hardcodedGuildId: ['NEXT_PUBLIC_HARDCODED_GUILD_ID', 'HARDCODED_GUILD_ID', 'GUILD_ID'],
      raidPileChannelId: ['DISCORD_RAID_PILE_CHANNEL_ID', 'NEXT_PUBLIC_DISCORD_RAID_PILE_CHANNEL_ID'],
      hardcodedAdminDiscordId: ['NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID', 'HARDCODED_ADMIN_DISCORD_ID'],
      hardcodedAdminTwitchId: ['NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID', 'HARDCODED_ADMIN_TWITCH_ID'],
      chatTagChannelId: ['CHAT_TAG_CHANNEL_ID', 'DISCORD_CHAT_TAG_CHANNEL_ID', 'DISCORD_TAG_CHANNEL_ID'],
      discordShoutoutChannelId: ['DISCORD_SHOUTOUT_CHANNEL_ID'],
      gifStorageChannelId: ['GIF_STORAGE_CHANNEL_ID', 'DISCORD_GIF_STORAGE_CHANNEL_ID'],
    }[key] || [],
    config.publicIds[key] || DEFAULT_RUNTIME_CONFIG.publicIds[key] || ''
  );
}

export function getRuntimePublicNumber(key: keyof RuntimeConfig['publicNumbers']): number {
  const config = readRuntimeConfig();
  const envKeyMap: Record<string, string[]> = {
    pointsTwitchFollow: ['POINTS_TWITCH_FOLLOW'],
    pointsTwitchSub: ['POINTS_TWITCH_SUB'],
    pointsTwitchBits: ['POINTS_TWITCH_BITS'],
    pointsTwitchRaid: ['POINTS_TWITCH_RAID'],
    pointsTwitchHost: ['POINTS_TWITCH_HOST'],
    pointsStreamAttendance: ['POINTS_STREAM_ATTENDANCE'],
    pointsDiscordMessage: ['POINTS_DISCORD_MESSAGE'],
    pointsDiscordReaction: ['POINTS_DISCORD_REACTION'],
    pointsDiscordVoiceMinute: ['POINTS_DISCORD_VOICE_MINUTE'],
    pointsDiscordHelpReaction: ['POINTS_DISCORD_HELP_REACTION'],
    pointsCommunityHelp: ['POINTS_COMMUNITY_HELP'],
    pointsDailyBonus: ['POINTS_DAILY_BONUS'],
    raidPilePointsReward: ['RAID_PILE_POINTS_REWARD'],
    raidPileMaxSize: ['RAID_PILE_MAX_SIZE'],
    raidPileMinSize: ['RAID_PILE_MIN_SIZE'],
  };
  const fallback = config.publicNumbers?.[key] ?? DEFAULT_RUNTIME_CONFIG.publicNumbers[key] ?? 0;
  return readEnvNumber(envKeyMap[key] || [], fallback);
}

export function getRuntimePublicFlag(key: keyof RuntimeConfig['publicFlags']): boolean {
  const config = readRuntimeConfig();
  const envKeyMap: Record<string, string[]> = {
    discordChatHandleWatch: ['DISCORD_CHAT_HANDLE_WATCH'],
    discordDebugEnvLogs: ['DISCORD_DEBUG_ENV_LOGS'],
  };
  const fallbackValue = Boolean(config.publicFlags[key] ?? DEFAULT_RUNTIME_CONFIG.publicFlags[key]);
  if (!isProduction()) {
    for (const envKey of envKeyMap[key] || []) {
      const raw = process.env[envKey];
      if (typeof raw === 'string' && raw.trim()) {
        return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
      }
    }
  }
  return fallbackValue;
}

export function getRuntimePublicText(key: keyof RuntimeConfig['publicText']): string {
  const config = readRuntimeConfig();
  if (!isProduction()) {
    const envKeyMap: Record<string, string[]> = {
      chatTagWebhookName: ['CHAT_TAG_WEBHOOK_NAME'],
      chatTagAvatarUrl: ['CHAT_TAG_AVATAR_URL', 'DISCORD_CHAT_TAG_AVATAR_URL'],
      spaceMountainIconUrl: ['SPACE_MOUNTAIN_ICON_URL', 'DISCORD_AUTHOR_ICON_URL'],
      discordPublicKey: ['DISCORD_PUBLIC_KEY'],
      storagePath: ['STORAGE_PATH'],
      puppeteerExecutablePath: ['PUPPETEER_EXECUTABLE_PATH'],
      databaseFilePath: ['DB_FILE'],
    };
    for (const envKey of envKeyMap[key] || []) {
      const value = process.env[envKey];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return config.publicText?.[key] || DEFAULT_RUNTIME_CONFIG.publicText[key] || '';
}

export function getAppUrl(): string {
  return getRuntimePublicUrl('appUrl');
}

export function getBaseUrl(): string {
  return getRuntimePublicUrl('baseUrl');
}

export function getChatTagApiBase(): string {
  return getRuntimePublicUrl('chatTagApiBase');
}

export function getChatTagBotUrl(): string {
  return getRuntimePublicUrl('chatTagBotUrl');
}

export function getHearMeOutUrl(): string {
  return getRuntimePublicUrl('hearmeoutUrl');
}

export function getStreamweaverUrl(): string {
  return getRuntimePublicUrl('streamweaverUrl');
}

export function getDiscordInviteUrl(): string {
  return getRuntimePublicUrl('discordInviteUrl');
}

export function getTwitchClientId(): string {
  return getRuntimePublicId('twitchClientId');
}

export function getDiscordClientId(): string {
  return getRuntimePublicId('discordClientId');
}

export function getDiscordActivityApplicationId(): string {
  return getRuntimePublicId('discordActivityApplicationId');
}

export function getHardcodedGuildId(): string {
  return getRuntimePublicId('hardcodedGuildId');
}

export function getHardcodedAdminDiscordId(): string {
  return getRuntimePublicId('hardcodedAdminDiscordId');
}

export function getHardcodedAdminTwitchId(): string {
  return getRuntimePublicId('hardcodedAdminTwitchId');
}

export function getDiscordActivityVoiceChannelId(): string {
  return getRuntimePublicId('discordActivityVoiceChannelId');
}

export function getDiscordChatHandleWatchEnabled(): boolean {
  return getRuntimePublicFlag('discordChatHandleWatch');
}

export function getDiscordDebugEnvLogsEnabled(): boolean {
  return getRuntimePublicFlag('discordDebugEnvLogs');
}

export function getChatTagWebhookName(): string {
  return getRuntimePublicText('chatTagWebhookName');
}

export function getChatTagAvatarUrl(): string {
  return getRuntimePublicText('chatTagAvatarUrl');
}

export function getSpaceMountainIconUrl(): string {
  return getRuntimePublicText('spaceMountainIconUrl');
}

export function getDiscordPublicKey(): string {
  return getRuntimePublicText('discordPublicKey');
}

export function getStoragePath(): string {
  return getRuntimePublicText('storagePath');
}

export function getPuppeteerExecutablePath(): string {
  return (
    getRuntimePublicText('puppeteerExecutablePath') ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/usr/bin/chromium'
  );
}

export function getDatabaseFilePath(): string {
  return getRuntimePublicText('databaseFilePath');
}

export function getCrewBannerGifUrl(): string {
  return getRuntimePublicUrl('crewBannerGifUrl');
}

export function getClipWorkerUrl(): string {
  return getRuntimePublicUrl('clipWorkerUrl');
}

export function getChatTagChannelId(): string {
  return getRuntimePublicId('chatTagChannelId');
}

export function getDiscordShoutoutChannelId(): string {
  return getRuntimePublicId('discordShoutoutChannelId');
}

export function getGifStorageChannelId(): string {
  return getRuntimePublicId('gifStorageChannelId');
}

export function getPointsTwitchFollow(): number {
  return getRuntimePublicNumber('pointsTwitchFollow');
}

export function getPointsTwitchSub(): number {
  return getRuntimePublicNumber('pointsTwitchSub');
}

export function getPointsTwitchBits(): number {
  return getRuntimePublicNumber('pointsTwitchBits');
}

export function getPointsTwitchRaid(): number {
  return getRuntimePublicNumber('pointsTwitchRaid');
}

export function getPointsTwitchHost(): number {
  return getRuntimePublicNumber('pointsTwitchHost');
}

export function getPointsStreamAttendance(): number {
  return getRuntimePublicNumber('pointsStreamAttendance');
}

export function getPointsDiscordMessage(): number {
  return getRuntimePublicNumber('pointsDiscordMessage');
}

export function getPointsDiscordReaction(): number {
  return getRuntimePublicNumber('pointsDiscordReaction');
}

export function getPointsDiscordVoiceMinute(): number {
  return getRuntimePublicNumber('pointsDiscordVoiceMinute');
}

export function getPointsDiscordHelpReaction(): number {
  return getRuntimePublicNumber('pointsDiscordHelpReaction');
}

export function getPointsCommunityHelp(): number {
  return getRuntimePublicNumber('pointsCommunityHelp');
}

export function getPointsDailyBonus(): number {
  return getRuntimePublicNumber('pointsDailyBonus');
}

export function getRaidPilePointsReward(): number {
  return getRuntimePublicNumber('raidPilePointsReward');
}

export function getRaidPileMaxSize(): number {
  return getRuntimePublicNumber('raidPileMaxSize');
}

export function getRaidPileMinSize(): number {
  return getRuntimePublicNumber('raidPileMinSize');
}
