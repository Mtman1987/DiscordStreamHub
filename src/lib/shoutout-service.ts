'use server';

import { db } from '@/firebase/server-init';
import { getStreamByLogin, getClipsForUser } from '@/lib/twitch-api-service';
import { sendShoutout } from '@/lib/discord-sync-service';
import { getCurrentVipClip } from '@/lib/clip-rotation-service';

interface ShoutoutData {
  serverId: string;
  channelId: string;
  twitchLogin: string;
  group: 'Crew' | 'Partners' | 'Honored Guests' | 'Everyone Else' | 'Raid Pile';
}

export async function sendShoutoutToDiscord(data: ShoutoutData): Promise<string | null> {
  const { serverId, channelId, twitchLogin, group } = data;

  try {
    // Get stream info
    const stream = await getStreamByLogin(twitchLogin);
    if (!stream) {
      console.error(`No active stream found for ${twitchLogin}`);
      return null;
    }

    // Generate shoutout based on group
    const shoutoutMessage = await generateShoutoutMessage(twitchLogin, stream, group, serverId);

    // Send to Discord
    const messageId = await sendShoutout(serverId, channelId, shoutoutMessage);

    console.log(`Sent ${group} shoutout for ${twitchLogin} to channel ${channelId}`);
    return messageId;

  } catch (error) {
    console.error(`Error sending shoutout for ${twitchLogin}:`, error);
    return null;
  }
}

async function generateShoutoutMessage(twitchLogin: string, stream: any, group: string, serverId: string): Promise<any> {
  const baseMessage = `🚨 **${stream.user_name}** is now LIVE on Twitch!`;

  switch (group) {
    case 'Crew':
      return generateCrewShoutout(twitchLogin, stream, baseMessage, serverId);

    case 'Partners':
      return generatePartnersShoutout(twitchLogin, stream, baseMessage, serverId);

    case 'Honored Guests':
      return generateHonoredGuestsShoutout(twitchLogin, stream, baseMessage);

    case 'Everyone Else':
      return generateMountaineerShoutout(twitchLogin, stream, baseMessage);

    case 'Raid Pile':
      return generateRaidPileShoutout(twitchLogin, stream, baseMessage);

    default:
      return generateMountaineerShoutout(twitchLogin, stream, baseMessage);
  }
}

async function generateCrewShoutout(twitchLogin: string, stream: any, baseMessage: string, serverId: string): Promise<any> {
  const clip = await getCurrentVipClip(serverId);
  
  const embed = {
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
      {
        name: '🎮 Playing',
        value: stream.game_name,
        inline: true
      },
      {
        name: '👥 Viewers',
        value: stream.viewer_count.toString(),
        inline: true
      },
      {
        name: '🚀 Crew Status',
        value: 'Space Mountain Crew',
        inline: true
      }
    ],
    thumbnail: {
      url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
    },
    image: clip?.gifUrl ? {
      url: clip.gifUrl
    } : {
      url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
    },
    footer: {
      text: 'Twitch • Crew Member Shoutout'
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

async function generatePartnersShoutout(twitchLogin: string, stream: any, baseMessage: string, serverId: string): Promise<any> {
  // Get the user's Discord ID to fetch their specific clip
  const userDoc = await db.collection('servers').doc(serverId).collection('users')
    .where('twitchLogin', '==', twitchLogin).limit(1).get();
  
  let clip = null;
  if (!userDoc.empty) {
    const { getCurrentClipForUser } = await import('./clip-rotation-service');
    clip = await getCurrentClipForUser(serverId, userDoc.docs[0].id);
  }
  
  const embed = {
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
      {
        name: '🎮 Playing',
        value: stream.game_name,
        inline: true
      },
      {
        name: '👥 Viewers',
        value: stream.viewer_count.toString(),
        inline: true
      },
      {
        name: '🌟 Partner Status',
        value: 'Official Space Mountain Partner',
        inline: true
      }
    ],
    thumbnail: {
      url: stream.profile_image_url
    },
    image: clip?.gifUrl ? {
      url: clip.gifUrl
    } : {
      url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
    },
    footer: {
      text: 'Twitch • Space Mountain Partner Shoutout'
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

function generateHonoredGuestsShoutout(twitchLogin: string, stream: any, baseMessage: string): any {
  const embed = {
    title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n\n✨ *Honored Guest*`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: 0xFF8C00,
    thumbnail: {
      url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
    },
    image: {
      url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
    },
    footer: {
      text: 'Twitch • Honored Guest'
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

function generateMountaineerShoutout(twitchLogin: string, stream: any, baseMessage: string): any {
  const embed = {
    title: baseMessage,
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: 0x9146FF,
    thumbnail: {
      url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
    },
    image: {
      url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
    },
    footer: {
      text: 'Twitch • Mountaineer Shoutout'
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

function generateRaidPileShoutout(twitchLogin: string, stream: any, baseMessage: string): any {
  const embed = {
    title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: 0x4ECDC4,
    thumbnail: {
      url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
    },
    image: {
      url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
    },
    footer: {
      text: 'Twitch • Raid Pile Shoutout 🎯'
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

export async function getUserGroup(serverId: string, discordUserId: string): Promise<'Crew' | 'Partners' | 'Honored Guests' | 'Everyone Else' | 'Raid Pile'> {
  try {
    const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).get();
    const userData = userDoc.data();

    return userData?.group || 'Everyone Else';
  } catch (error) {
    console.error('Error getting user group:', error);
    return 'Everyone Else';
  }
}
