import { NextResponse } from 'next/server';
import {
  getRuntimePublicFlag,
  getRuntimePublicId,
  getRuntimePublicNumber,
  getRuntimePublicText,
  getRuntimePublicUrl,
} from '@/lib/runtime-config';

export async function GET() {
  return NextResponse.json({
    publicUrls: {
      appUrl: getRuntimePublicUrl('appUrl'),
      baseUrl: getRuntimePublicUrl('baseUrl'),
      chatTagApiBase: getRuntimePublicUrl('chatTagApiBase'),
      chatTagBotUrl: getRuntimePublicUrl('chatTagBotUrl'),
      hearmeoutUrl: getRuntimePublicUrl('hearmeoutUrl'),
      streamweaverUrl: getRuntimePublicUrl('streamweaverUrl'),
      discordInviteUrl: getRuntimePublicUrl('discordInviteUrl'),
      clipWorkerUrl: getRuntimePublicUrl('clipWorkerUrl'),
      crewBannerGifUrl: getRuntimePublicUrl('crewBannerGifUrl'),
    },
    publicIds: {
      twitchClientId: getRuntimePublicId('twitchClientId'),
      discordClientId: getRuntimePublicId('discordClientId'),
      discordActivityApplicationId: getRuntimePublicId('discordActivityApplicationId'),
      discordActivityVoiceChannelId: getRuntimePublicId('discordActivityVoiceChannelId'),
      raidPileChannelId: getRuntimePublicId('raidPileChannelId'),
      hardcodedGuildId: getRuntimePublicId('hardcodedGuildId'),
      hardcodedAdminDiscordId: getRuntimePublicId('hardcodedAdminDiscordId'),
      hardcodedAdminTwitchId: getRuntimePublicId('hardcodedAdminTwitchId'),
      chatTagChannelId: getRuntimePublicId('chatTagChannelId'),
      discordShoutoutChannelId: getRuntimePublicId('discordShoutoutChannelId'),
      gifStorageChannelId: getRuntimePublicId('gifStorageChannelId'),
    },
    publicText: {
      chatTagWebhookName: getRuntimePublicText('chatTagWebhookName'),
      chatTagAvatarUrl: getRuntimePublicText('chatTagAvatarUrl'),
      spaceMountainIconUrl: getRuntimePublicText('spaceMountainIconUrl'),
      discordPublicKey: getRuntimePublicText('discordPublicKey'),
      storagePath: getRuntimePublicText('storagePath'),
      puppeteerExecutablePath: getRuntimePublicText('puppeteerExecutablePath'),
      databaseFilePath: getRuntimePublicText('databaseFilePath'),
    },
    publicNumbers: {
      pointsTwitchFollow: getRuntimePublicNumber('pointsTwitchFollow'),
      pointsTwitchSub: getRuntimePublicNumber('pointsTwitchSub'),
      pointsTwitchBits: getRuntimePublicNumber('pointsTwitchBits'),
      pointsTwitchRaid: getRuntimePublicNumber('pointsTwitchRaid'),
      pointsTwitchHost: getRuntimePublicNumber('pointsTwitchHost'),
      pointsStreamAttendance: getRuntimePublicNumber('pointsStreamAttendance'),
      pointsDiscordMessage: getRuntimePublicNumber('pointsDiscordMessage'),
      pointsDiscordReaction: getRuntimePublicNumber('pointsDiscordReaction'),
      pointsDiscordVoiceMinute: getRuntimePublicNumber('pointsDiscordVoiceMinute'),
      pointsDiscordHelpReaction: getRuntimePublicNumber('pointsDiscordHelpReaction'),
      pointsCommunityHelp: getRuntimePublicNumber('pointsCommunityHelp'),
      pointsDailyBonus: getRuntimePublicNumber('pointsDailyBonus'),
      raidPilePointsReward: getRuntimePublicNumber('raidPilePointsReward'),
      raidPileMaxSize: getRuntimePublicNumber('raidPileMaxSize'),
      raidPileMinSize: getRuntimePublicNumber('raidPileMinSize'),
    },
    publicFlags: {
      discordChatHandleWatch: getRuntimePublicFlag('discordChatHandleWatch'),
      discordDebugEnvLogs: getRuntimePublicFlag('discordDebugEnvLogs'),
    },
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
