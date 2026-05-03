'use server';

import { db } from '@/lib/db';
import { getCurrentClipForUser } from './clip-rotation-service';
import { getStreamByLogin } from './twitch-api-service';
import { getServerBranding } from './server-branding';

export async function manageCommunitySpotlight(serverId: string): Promise<void> {
  try {
    console.log('[CommunitySpotlight] Starting spotlight rotation...');
    const branding = await getServerBranding(serverId);
    const liveMembers = await getLiveCommunityMembers(serverId);
    console.log(`[CommunitySpotlight] Found ${liveMembers.length} eligible live members`);
    
    if (liveMembers.length === 0) {
      console.log('[CommunitySpotlight] No eligible members, clearing spotlight');
      await clearSpotlight(serverId);
      return;
    }

    // Always spotlight someone if members are live (even if just 1)
    const currentSpotlight = await getCurrentSpotlight(serverId);
    const nextIndex = liveMembers.length === 1 ? 0 : (currentSpotlight?.currentIndex || 0) % liveMembers.length;
    const newSpotlightMember = liveMembers[nextIndex];
    const oldSpotlightUserId = currentSpotlight?.userId;
    
    console.log(`[CommunitySpotlight] Rotating from ${oldSpotlightUserId || 'none'} to ${newSpotlightMember.discordUserId} (${newSpotlightMember.twitchLogin})`);

    // Try to get existing GIF first, then fetch new clip if needed
    const { getNextGifCdnUrl } = await import('./gif-rotation-service');
    let gifUrl = await getNextGifCdnUrl(serverId, newSpotlightMember.discordUserId, newSpotlightMember.twitchLogin);
    
    // If no existing GIF, use stream thumbnail (clip worker will create GIFs independently)
    if (!gifUrl) {
      console.log(`[CommunitySpotlight] No existing GIF for ${newSpotlightMember.twitchLogin}, using stream thumbnail`);
    }
    
    const newClip = gifUrl ? { gifUrl } : null;
    console.log(`[CommunitySpotlight] GIF URL for ${newSpotlightMember.twitchLogin}: ${gifUrl || 'none'}`);

    // Get stream info for new spotlight
    const newStream = await getStreamByLogin(newSpotlightMember.twitchLogin);
    if (!newStream) return;

    const { editDiscordMessage } = await import('./discord-sync-service');

    // Update OLD spotlight user back to normal (if exists and different from new)
    if (oldSpotlightUserId && oldSpotlightUserId !== newSpotlightMember.discordUserId) {
      const oldShoutoutState = await getShoutoutState(serverId, oldSpotlightUserId);
      if (oldShoutoutState?.messageId) {
        const oldMember = liveMembers.find(m => m.discordUserId === oldSpotlightUserId);
        const oldTwitchLogin = oldMember?.twitchLogin || oldShoutoutState.twitchLogin || '';
        const oldStream = oldTwitchLogin ? await getStreamByLogin(oldTwitchLogin) : null;
        if (oldStream) {
          const oldEmbed = oldMember?.group === 'Honored Guests' ? {
            title: `🚨 **${oldStream.user_name}** is now LIVE on Twitch!`,
            description: `**${oldStream.title}**\n🎮 Playing: ${oldStream.game_name}\n👥 Viewers: ${oldStream.viewer_count}\n\n✨ *Honored Guest*`,
            url: `https://twitch.tv/${oldStream.user_login}`,
            color: 0xFF8C00,
            thumbnail: { url: oldStream.thumbnail_url.replace('{width}', '50').replace('{height}', '50') },
            image: { url: oldStream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
            footer: { text: 'Twitch • Honored Guest' },
            timestamp: new Date().toISOString()
          } : {
            title: `🚨 **${oldStream.user_name}** is now LIVE on Twitch!`,
            description: `**${oldStream.title}**\n🎮 Playing: ${oldStream.game_name}\n👥 Viewers: ${oldStream.viewer_count}`,
            url: `https://twitch.tv/${oldStream.user_login}`,
            color: 0x9146FF,
            thumbnail: { url: oldStream.thumbnail_url.replace('{width}', '50').replace('{height}', '50') },
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
      const spaceMountainLogo = 'https://cdn.discordapp.com/emojis/1284931162896334929.gif';
      const newEmbed = newSpotlightMember.group === 'Honored Guests' ? {
        title: `🚨 **${newStream.user_name}** is now LIVE on Twitch!`,
        description: `**${newStream.title}**\n🎮 Playing: ${newStream.game_name}\n👥 Viewers: ${newStream.viewer_count}\n\n✨ *Honored Guest*`,
        url: `https://twitch.tv/${newSpotlightMember.twitchLogin}`,
        color: 0xFF8C00,
        thumbnail: { url: spaceMountainLogo },
        image: newClip?.gifUrl ? { url: newClip.gifUrl } : { url: newStream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') },
        footer: { text: 'Twitch • ⭐ COMMUNITY SPOTLIGHT ⭐' },
        timestamp: new Date().toISOString()
      } : {
        title: `🚨 **${newStream.user_name}** is now LIVE on Twitch!`,
        description: `**${newStream.title}**\n🎮 Playing: ${newStream.game_name}\n👥 Viewers: ${newStream.viewer_count}`,
        url: `https://twitch.tv/${newSpotlightMember.twitchLogin}`,
        color: 0x9146FF,
        thumbnail: { url: spaceMountainLogo },
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
      username: newStream.user_name,
      twitchLogin: newSpotlightMember.twitchLogin,
      avatarUrl: newStream.thumbnail_url.replace('{width}', '300').replace('{height}', '300'),
      gifUrl: gifUrl || null,
      viewerCount: newStream.viewer_count,
      gameTitle: newStream.game_name,
      streamTitle: newStream.title,
      rotatedAt: new Date()
    });
    
    // Update the pinned spotlight embed at bottom of channel
    console.log('[CommunitySpotlight] About to call updateSpotlightPinnedEmbed...');
    try {
      await updateSpotlightPinnedEmbed(serverId, newSpotlightMember, newStream, gifUrl);
      console.log('[CommunitySpotlight] updateSpotlightPinnedEmbed completed');
    } catch (embedError) {
      console.error('[CommunitySpotlight] updateSpotlightPinnedEmbed failed:', embedError);
    }

    console.log(`[CommunitySpotlight] ✅ Spotlight rotated to ${newSpotlightMember.twitchLogin}`);
  } catch (error) {
    console.error('[CommunitySpotlight] ❌ Error:', error);
  }
}

async function updateSpotlightPinnedEmbed(serverId: string, member: any, stream: any, gifUrl: string | null): Promise<void> {
  try {
    console.log('[CommunitySpotlight] Updating pinned embed...');
    const { postDiscordMessage, deleteDiscordMessage } = await import('./discord-sync-service');
    const branding = await getServerBranding(serverId);
    
    // Get community channel ID
    const groupChannelsDoc = await db.collection('servers').doc(serverId).collection('config').doc('groupChannels').get();
    const channelId = groupChannelsDoc.data()?.['Everyone Else'];
    console.log('[CommunitySpotlight] Community channel ID:', channelId);
    if (!channelId) {
      console.log('[CommunitySpotlight] No community channel configured');
      return;
    }
    
    // Delete old pinned embed if exists
    const spotlightDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('pinnedEmbed').get();
    if (spotlightDoc.exists && spotlightDoc.data()?.messageId) {
      console.log('[CommunitySpotlight] Deleting old pinned embed:', spotlightDoc.data()!.messageId);
      await deleteDiscordMessage(serverId, channelId, spotlightDoc.data()!.messageId).catch(() => {});
    }
    
    // Create small spotlight embed with GIF in thumbnail
    const embed = {
      title: '⭐ COMMUNITY SPOTLIGHT ⭐',
      description: `**${stream.user_name}** is featured!\n[Watch Stream](https://twitch.tv/${member.twitchLogin})`,
      color: 0xFFD700,
      thumbnail: gifUrl ? { url: gifUrl } : { url: stream.thumbnail_url.replace('{width}', '300').replace('{height}', '300') },
      fields: [
        { name: '🎮 Game', value: stream.game_name, inline: true },
        { name: '👥 Viewers', value: stream.viewer_count.toString(), inline: true },
        { name: '🔄 Rotates', value: 'Every 10 min', inline: true }
      ]
    };
    
    console.log('[CommunitySpotlight] Posting pinned embed to channel:', channelId);
    // Post new pinned embed with button
    const messageId = await postDiscordMessage(serverId, channelId, { 
      embeds: [embed],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              label: '🔗 Link Your Twitch & Get Shoutouts',
              custom_id: 'link_twitch_account'
            }
          ]
        }
      ]
    });
    console.log('[CommunitySpotlight] Posted pinned embed with messageId:', messageId);
    
    if (!messageId) {
      console.error('[CommunitySpotlight] Failed to post pinned embed - no messageId returned');
      return;
    }
    
    // Save message ID so we can delete it next rotation
    await db.collection('servers').doc(serverId).collection('spotlight').doc('pinnedEmbed').set({
      messageId,
      channelId,
      userId: member.discordUserId,
      updatedAt: new Date()
    });
    
    console.log(`[CommunitySpotlight] ✅ Posted pinned embed for ${member.twitchLogin}`);
  } catch (error) {
    console.error('[CommunitySpotlight] ❌ Error updating pinned embed:', error);
  }
}

async function getLiveCommunityMembers(serverId: string) {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users')
    .get();

  console.log(`[CommunitySpotlight] Total users: ${snapshot.size}`);
  const members = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    
    // Include ALL groups in spotlight rotation
    const shoutoutState = await db.collection('servers').doc(serverId)
      .collection('users').doc(doc.id)
      .collection('shoutoutState').doc('current').get();
    
    const isLive = shoutoutState.exists && shoutoutState.data()?.isLive;
    if (isLive && data.twitchLogin) {
      console.log(`[CommunitySpotlight] ${data.twitchLogin}: group=${data.group}, isLive=true`);
      members.push({
        discordUserId: doc.id,
        twitchLogin: data.twitchLogin,
        group: data.group || 'Community'
      });
    }
  }
  
  return members.sort((a, b) => a.twitchLogin.localeCompare(b.twitchLogin));
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
