'use server';

import { db } from '@/data/server-init';
import { getStreamByLogin } from '@/lib/twitch-api-service';
import { sendShoutout } from '@/lib/discord-sync-service';
import { getCurrentClipForUser } from '@/lib/clip-rotation-service';
import { getCrewBannerUrl } from '@/lib/banner-generation-service';
import { getEmbedTemplates } from '@/lib/embed-templates';

interface ShoutoutData {
  serverId: string;
  channelId: string;
  twitchLogin: string;
  group: 'Crew' | 'Partners' | 'Honored Guests' | 'Everyone Else' | 'Raid Pile';
  stream?: any;
}

export async function sendShoutoutToDiscord(data: ShoutoutData): Promise<string | null> {
  const { serverId, channelId, twitchLogin, group } = data;

  try {
    // Get stream info
    const stream = data.stream || await getStreamByLogin(twitchLogin);
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
      return await generateHonoredGuestsShoutout(twitchLogin, stream, baseMessage);

    case 'Everyone Else':
      return await generateMountaineerShoutout(twitchLogin, stream, baseMessage, serverId);

    case 'Raid Pile':
      return await generateRaidPileShoutout(twitchLogin, stream, baseMessage);

    default:
      return generateMountaineerShoutout(twitchLogin, stream, baseMessage, serverId);
  }
}

async function generateCrewShoutout(twitchLogin: string, stream: any, baseMessage: string, serverId: string): Promise<any> {
  const { getUserByLogin } = await import('./twitch-api-service');
  const templates = await getEmbedTemplates(serverId);
  const userInfo = await getUserByLogin(twitchLogin);

  const userDoc = await db.collection('servers').doc(serverId).collection('users')
    .where('twitchLogin', '==', twitchLogin).limit(1).get();

  let clip = null;
  if (!userDoc.empty) {
    clip = await getCurrentClipForUser(serverId, userDoc.docs[0].id);
  }

  const fallbackBannerUrl = process.env.CREW_BANNER_GIF_URL || 'https://via.placeholder.com/1920x120/00D9FF/FFFFFF?text=SPACE+MOUNTAIN+CREW';
  const bannerUrl = (await getCrewBannerUrl(twitchLogin)) || fallbackBannerUrl;

  const bannerEmbed = {
    image: { url: bannerUrl },
    color: 0x00D9FF
  };
  
  const embed = {
    author: {
      name: templates.crew.title.replace('{username}', stream.user_name),
      icon_url: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif',
      url: `https://twitch.tv/${twitchLogin}`
    },
    title: `🚀 **${stream.title}**`,
    description: templates.crew.description,
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
        value: templates.crew.badge,
        inline: true
      }
    ],
    thumbnail: {
      url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
    },
    image: clip?.gifUrl ? { url: clip.gifUrl } : { url: fallbackBannerUrl },
    footer: {
      text: templates.crew.footer
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [bannerEmbed, embed] };
}

async function generatePartnersShoutout(twitchLogin: string, stream: any, baseMessage: string, serverId: string): Promise<any> {
  const { getUserByLogin } = await import('./twitch-api-service');
  const userInfo = await getUserByLogin(twitchLogin);
  const templates = await getEmbedTemplates(serverId);
  const fallbackGifUrl = process.env.CREW_BANNER_GIF_URL || 'https://via.placeholder.com/1920x120/00D9FF/FFFFFF?text=SPACE+MOUNTAIN+CREW';
  
  const userDoc = await db.collection('servers').doc(serverId).collection('users')
    .where('twitchLogin', '==', twitchLogin).limit(1).get();
  
  let clip = null;
  let partnerDiscordLink = 'https://discord.gg/spacemountain';
  
  if (!userDoc.empty) {
    const { getCurrentClipForUser } = await import('./clip-rotation-service');
    clip = await getCurrentClipForUser(serverId, userDoc.docs[0].id);
    const userData = userDoc.docs[0].data();
    if (userData.partnerDiscordLink) {
      partnerDiscordLink = userData.partnerDiscordLink;
    }
  }
  
  const embed = {
    author: {
      name: templates.partners.title.replace('{username}', stream.user_name),
      icon_url: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif',
      url: `https://twitch.tv/${twitchLogin}`
    },
    title: `🌌 **${stream.title}**`,
    description: templates.partners.description,
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
        value: templates.partners.badge,
        inline: true
      }
    ],
    thumbnail: {
      url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
    },
    image: clip?.gifUrl ? { url: clip.gifUrl } : { url: fallbackGifUrl },
    footer: {
      text: templates.partners.footer
    },
    timestamp: new Date().toISOString()
  };

  return { 
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'Watch on Twitch',
            url: `https://twitch.tv/${twitchLogin}`,
            emoji: { name: '📺' }
          },
          {
            type: 2,
            style: 5,
            label: 'Join Their Discord',
            url: partnerDiscordLink,
            emoji: { name: '💬' }
          }
        ]
      }
    ]
  };
}

async function generateHonoredGuestsShoutout(twitchLogin: string, stream: any, baseMessage: string): Promise<any> {
  const { getUserByLogin } = await import('./twitch-api-service');
  const userInfo = await getUserByLogin(twitchLogin);
  
  const embed = {
    title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n\n✨ *Honored Guest*`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: 0xFF8C00,
    thumbnail: {
      url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
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

async function generateMountaineerShoutout(twitchLogin: string, stream: any, baseMessage: string, serverId?: string): Promise<any> {
  const { getUserByLogin } = await import('./twitch-api-service');
  const userInfo = await getUserByLogin(twitchLogin);
  const templates = serverId ? await getEmbedTemplates(serverId) : { community: { title: '🎬 {username} is LIVE!', footer: 'Twitch • Mountaineer Shoutout' } };
  
  const embed = {
    title: templates.community.title.replace('{username}', stream.user_name),
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: 0x9146FF,
    thumbnail: {
      url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
    },
    image: {
      url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
    },
    footer: {
      text: templates.community.footer
    },
    timestamp: new Date().toISOString()
  };

  return { embeds: [embed] };
}

async function generateRaidPileShoutout(twitchLogin: string, stream: any, baseMessage: string): Promise<any> {
  const { getUserByLogin } = await import('./twitch-api-service');
  const userInfo = await getUserByLogin(twitchLogin);
  
  const embed = {
    title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
    description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
    url: `https://twitch.tv/${twitchLogin}`,
    color: 0x4ECDC4,
    thumbnail: {
      url: userInfo?.profile_image_url || 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
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
