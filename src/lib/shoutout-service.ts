'use server';

import { db } from '@/firebase/server-init';
import { getStreamByLogin, getClipsForUser } from '@/lib/twitch-api-service';
import { sendShoutout } from '@/lib/discord-sync-service';

interface ShoutoutData {
  serverId: string;
  channelId: string;
  twitchLogin: string;
  group: 'Community' | 'VIP' | 'Mountaineer' | 'Train' | 'Pile';
}

export async function sendShoutoutToDiscord(data: ShoutoutData): Promise<void> {
  const { serverId, channelId, twitchLogin, group } = data;

  try {
    // Get stream info
    const stream = await getStreamByLogin(twitchLogin);
    if (!stream) {
      console.error(`No active stream found for ${twitchLogin}`);
      return;
    }

    // Generate shoutout based on group
    const shoutoutMessage = await generateShoutoutMessage(twitchLogin, stream, group);

    // Send to Discord
    await sendShoutout(serverId, channelId, shoutoutMessage);

    console.log(`Sent ${group} shoutout for ${twitchLogin} to channel ${channelId}`);

  } catch (error) {
    console.error(`Error sending shoutout for ${twitchLogin}:`, error);
    throw error;
  }
}

async function generateShoutoutMessage(twitchLogin: string, stream: any, group: string): Promise<any> {
  const baseMessage = `🚨 **${stream.user_name}** is now LIVE on Twitch!`;

  switch (group) {
    case 'Community':
      return generateCommunityShoutout(twitchLogin, stream, baseMessage);

    case 'VIP':
      return generateVIPShoutout(twitchLogin, stream, baseMessage);

    case 'Mountaineer':
      return generateCommunityShoutout(twitchLogin, stream, baseMessage); // Same as community for now

    case 'Train':
    case 'Pile':
      return generateRaidShoutout(twitchLogin, stream, baseMessage, group);

    default:
      return generateCommunityShoutout(twitchLogin, stream, baseMessage);
  }
}

function generateCommunityShoutout(twitchLogin: string, stream: any, baseMessage: string): any {
  const embed = {
    title: baseMessage,
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: 0x9146FF, // Twitch purple
    thumbnail: {
      url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
    },
    footer: {
      text: 'Twitch • Community Shoutout'
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

async function generateVIPShoutout(twitchLogin: string, stream: any, baseMessage: string): Promise<any> {
  try {
    // Try to get a recent clip for GIF generation
    const clips = await getClipsForUser(stream.user_id, 1);
    const hasClips = clips.length > 0;

    const embed = {
      title: baseMessage,
      description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n${hasClips ? '🎬 Featuring recent highlights!' : ''}`,
      url: `https://twitch.tv/${twitchLogin}`,
      color: 0xFFD700, // Gold for VIP
      thumbnail: {
        url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
      },
      image: hasClips ? {
        url: clips[0].thumbnail_url
      } : undefined,
      footer: {
        text: 'Twitch • VIP Shoutout ✨'
      },
      timestamp: new Date().toISOString()
    };

    return { embeds: [embed] };
  } catch (error) {
    console.error('Error generating VIP shoutout:', error);
    // Fallback to community shoutout
    return generateCommunityShoutout(twitchLogin, stream, baseMessage);
  }
}

function generateRaidShoutout(twitchLogin: string, stream: any, baseMessage: string, group: string): any {
  const raidType = group === 'Train' ? '🚂 Community Train' : '🎯 Raid Pile';

  const embed = {
    title: `${raidType} - ${baseMessage}`,
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n\n🎪 Join the ${raidType.toLowerCase()} and help build momentum!`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: group === 'Train' ? 0xFF6B6B : 0x4ECDC4, // Red for train, teal for pile
    thumbnail: {
      url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
    },
    footer: {
      text: `Twitch • ${raidType} Shoutout`
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

export async function getUserGroup(serverId: string, discordUserId: string): Promise<'Community' | 'VIP' | 'Mountaineer' | 'Train' | 'Pile'> {
  try {
    const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).get();
    const userData = userDoc.data();

    return userData?.group || 'Community';
  } catch (error) {
    console.error('Error getting user group:', error);
    return 'Community';
  }
}
