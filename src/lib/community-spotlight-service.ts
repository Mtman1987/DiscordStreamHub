'use server';

import { db } from '@/firebase/server-init';
import { fetchNewClipOnLive, getCurrentClipForUser } from './clip-rotation-service';
import { getStreamByLogin } from './twitch-api-service';
import { getServerBranding } from './server-branding';

export async function manageCommunitySpotlight(serverId: string): Promise<void> {
  try {
    const branding = await getServerBranding(serverId);
    const liveMembers = await getLiveCommunityMembers(serverId);
    if (liveMembers.length === 0) {
      await clearSpotlight(serverId);
      return;
    }

    const currentSpotlight = await getCurrentSpotlight(serverId);
    const nextIndex = (currentSpotlight?.currentIndex || 0) % liveMembers.length;
    const newSpotlightMember = liveMembers[nextIndex];
    const oldSpotlightUserId = currentSpotlight?.userId;

    // Fetch clip for new spotlight user (respects 24hr limit)
    await fetchNewClipOnLive(serverId, newSpotlightMember.discordUserId, newSpotlightMember.twitchLogin);
    const newClip = await getCurrentClipForUser(serverId, newSpotlightMember.discordUserId);

    // Get stream info for new spotlight
    const newStream = await getStreamByLogin(newSpotlightMember.twitchLogin);
    if (!newStream) return;

    const { editDiscordMessage } = await import('./discord-sync-service');

    // Update OLD spotlight user back to normal (if exists and different from new)
    if (oldSpotlightUserId && oldSpotlightUserId !== newSpotlightMember.discordUserId) {
      const oldShoutoutState = await getShoutoutState(serverId, oldSpotlightUserId);
      if (oldShoutoutState?.messageId) {
        const oldStream = await getStreamByLogin(oldShoutoutState.twitchLogin || '');
        if (oldStream) {
          const oldMember = liveMembers.find(m => m.discordUserId === oldSpotlightUserId);
          const oldEmbed = oldMember?.group === 'Honored Guests' ? {
            title: `🚨 **${oldStream.user_name}** is now LIVE on Twitch!`,
            description: `**${oldStream.title}**\n🎮 Playing: ${oldStream.game_name}\n👥 Viewers: ${oldStream.viewer_count}\n\n✨ *Honored Guest*`,
            url: `https://twitch.tv/${oldStream.user_login}`,
            color: 0xFF8C00,
            thumbnail: { url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
            image: { url: oldStream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
            footer: { text: 'Twitch • Honored Guest' },
            timestamp: new Date().toISOString()
          } : {
            title: `🚨 **${oldStream.user_name}** is now LIVE on Twitch!`,
            description: `**${oldStream.title}**\n🎮 Playing: ${oldStream.game_name}\n👥 Viewers: ${oldStream.viewer_count}`,
            url: `https://twitch.tv/${oldStream.user_login}`,
            color: 0x9146FF,
            thumbnail: { url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
            image: { url: oldStream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
            footer: { text: `Twitch • ${branding.communityMemberName} Shoutout` },
            timestamp: new Date().toISOString()
          };
          
          await editDiscordMessage(serverId, oldShoutoutState.channelId, oldShoutoutState.messageId, { embeds: [oldEmbed] });
        }
      }
    }

    // Update NEW spotlight user with GIF and special footer
    const newShoutoutState = await getShoutoutState(serverId, newSpotlightMember.discordUserId);
    if (newShoutoutState?.messageId) {
      const newEmbed = newSpotlightMember.group === 'Honored Guests' ? {
        title: `🚨 **${newStream.user_name}** is now LIVE on Twitch!`,
        description: `**${newStream.title}**\n🎮 Playing: ${newStream.game_name}\n👥 Viewers: ${newStream.viewer_count}\n\n✨ *Honored Guest*`,
        url: `https://twitch.tv/${newSpotlightMember.twitchLogin}`,
        color: 0xFF8C00,
        thumbnail: { url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: newClip?.gifUrl ? { url: newClip.gifUrl } : { url: newStream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • ⭐ COMMUNITY SPOTLIGHT ⭐' },
        timestamp: new Date().toISOString()
      } : {
        title: `🚨 **${newStream.user_name}** is now LIVE on Twitch!`,
        description: `**${newStream.title}**\n🎮 Playing: ${newStream.game_name}\n👥 Viewers: ${newStream.viewer_count}`,
        url: `https://twitch.tv/${newSpotlightMember.twitchLogin}`,
        color: 0x9146FF,
        thumbnail: { url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png' },
        image: newClip?.gifUrl ? { url: newClip.gifUrl } : { url: newStream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • ⭐ COMMUNITY SPOTLIGHT ⭐' },
        timestamp: new Date().toISOString()
      };
      
      await editDiscordMessage(serverId, newShoutoutState.channelId, newShoutoutState.messageId, { embeds: [newEmbed] });
    }

    // Save new spotlight state
    await saveSpotlight(serverId, {
      currentIndex: nextIndex + 1,
      userId: newSpotlightMember.discordUserId,
      lastUpdated: new Date()
    });

    console.log(`[CommunitySpotlight] Spotlighting ${newSpotlightMember.twitchLogin}`);
  } catch (error) {
    console.error('[CommunitySpotlight] Error:', error);
  }
}

async function getLiveCommunityMembers(serverId: string) {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users')
    .where('group', 'in', ['Honored Guests', 'Everyone Else'])
    .get();

  const members = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const shoutoutState = await db.collection('servers').doc(serverId)
      .collection('users').doc(doc.id)
      .collection('shoutoutState').doc('current').get();
    
    if (shoutoutState.exists && shoutoutState.data()?.isLive && data.twitchLogin) {
      members.push({
        discordUserId: doc.id,
        twitchLogin: data.twitchLogin,
        group: data.group
      });
    }
  }
  
  return members;
}

async function getShoutoutState(serverId: string, discordUserId: string): Promise<any> {
  const doc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
    .collection('shoutoutState').doc('current').get();
  return doc.exists ? doc.data() : null;
}

async function getCurrentSpotlight(serverId: string) {
  const doc = await db.collection('servers').doc(serverId)
    .collection('spotlight').doc('current').get();
  return doc.exists ? doc.data() : null;
}

async function saveSpotlight(serverId: string, data: any) {
  await db.collection('servers').doc(serverId)
    .collection('spotlight').doc('current').set(data);
}

async function clearSpotlight(serverId: string) {
  await db.collection('servers').doc(serverId)
    .collection('spotlight').doc('current').delete();
}
