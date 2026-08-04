'use server';

import { db } from '@/lib/db';
import { getCurrentClipForUser } from './clip-rotation-service';
import { getStreamByLogin } from './twitch-api-service';
import { getServerBranding } from './server-branding';
import { buildSpmtOnboardingButton } from './spmt-onboarding-contract';

function isRepostableDiscordEditError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Maximum number of edits to messages older than 1 hour reached|code["']?\s*:\s*30046|30046|404|MESSAGE_NOT_FOUND|Unknown Message/i.test(message);
}

async function replaceTrackedShoutoutMessage(
  serverId: string,
  discordUserId: string,
  shoutoutState: any,
  payload: any,
): Promise<void> {
  const { deleteDiscordMessage, postDiscordMessage } = await import('./discord-sync-service');
  await deleteDiscordMessage(serverId, shoutoutState.channelId, shoutoutState.messageId).catch(() => {});
  const newMessageId = await postDiscordMessage(serverId, shoutoutState.channelId, payload);
  if (!newMessageId) {
    throw new Error(`Failed to repost tracked shoutout for ${discordUserId}`);
  }

  await db.collection('servers').doc(serverId).collection('users').doc(discordUserId)
    .collection('shoutoutState').doc('current').set({
      ...shoutoutState,
      messageId: newMessageId,
      lastUpdated: new Date(),
    }, { merge: true });
}

export async function manageCommunitySpotlight(serverId: string): Promise<void> {
  try {
    const branding = await getServerBranding(serverId);
    const liveMembers = await getLiveCommunityMembers(serverId);
    
    if (liveMembers.length === 0) {
      await clearSpotlight(serverId);
      return;
    }

    // Always spotlight someone if members are live (even if just 1)
    const currentSpotlight = await getCurrentSpotlight(serverId);
    const nextIndex = liveMembers.length === 1 ? 0 : (currentSpotlight?.currentIndex || 0) % liveMembers.length;
    const newSpotlightMember = liveMembers[nextIndex];
    const oldSpotlightUserId = currentSpotlight?.userId;
    
    // Try to get existing GIF first, then fetch new clip if needed
    const { getNextGifCdnUrl } = await import('./gif-rotation-service');
    const gifUrl = await getNextGifCdnUrl(serverId, newSpotlightMember.discordUserId, newSpotlightMember.twitchLogin);
    
    const newClip = gifUrl ? { gifUrl } : null;

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
          
          const payload = { embeds: [oldEmbed] };
          try {
            await editDiscordMessage(serverId, oldShoutoutState.channelId, oldShoutoutState.messageId, payload);
          } catch (error) {
            if (!isRepostableDiscordEditError(error)) throw error;
            console.log(`[CommunitySpotlight] Old spotlight message too old or missing for ${oldSpotlightUserId}, reposting`);
            await replaceTrackedShoutoutMessage(serverId, oldSpotlightUserId, oldShoutoutState, payload);
          }
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
      
      const payload = { embeds: [newEmbed] };
      try {
        await editDiscordMessage(serverId, newShoutoutState.channelId, newShoutoutState.messageId, payload);
      } catch (error) {
        if (!isRepostableDiscordEditError(error)) throw error;
        console.log(`[CommunitySpotlight] New spotlight message too old or missing for ${newSpotlightMember.discordUserId}, reposting`);
        await replaceTrackedShoutoutMessage(serverId, newSpotlightMember.discordUserId, newShoutoutState, payload);
      }
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
    try {
      await updateSpotlightPinnedEmbed(serverId, newSpotlightMember, newStream, gifUrl);
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
    const { postDiscordMessage, deleteDiscordMessage } = await import('./discord-sync-service');
    const branding = await getServerBranding(serverId);
    
    // Get community channel ID
    const groupChannelsDoc = await db.collection('servers').doc(serverId).collection('config').doc('groupChannels').get();
    const channelId = groupChannelsDoc.data()?.['Everyone Else'];
    if (!channelId) {
      return;
    }
    
    // Delete old pinned embed if exists
    const spotlightDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('pinnedEmbed').get();
    if (spotlightDoc.exists && spotlightDoc.data()?.messageId) {
      const pinned = spotlightDoc.data()!;
      await deleteDiscordMessage(serverId, pinned.channelId || channelId, pinned.messageId);
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
    
    // Post new pinned embed with button
    const messageId = await postDiscordMessage(serverId, channelId, { 
      embeds: [embed],
      components: [
        {
          type: 1,
          components: [
            buildSpmtOnboardingButton(),
          ]
        }
      ]
    });
    
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
    
  } catch (error) {
    console.error('[CommunitySpotlight] ❌ Error updating pinned embed:', error);
  }
}

async function getLiveCommunityMembers(serverId: string) {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users')
    .get();

  const members = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    
    // Include ALL groups in spotlight rotation
    const shoutoutState = await db.collection('servers').doc(serverId)
      .collection('users').doc(doc.id)
      .collection('shoutoutState').doc('current').get();
    
    const isLive = shoutoutState.exists && shoutoutState.data()?.isLive;
    if (isLive && data.twitchLogin) {
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
