'use server';

import { db } from '@/firebase/server-init';
import { fetchNewClipOnLive, getCurrentClipForUser } from './clip-rotation-service';
import { sendShoutout } from '@/lib/discord-sync-service';
import { getStreamByLogin } from './twitch-api-service';

export async function manageCommunitySpotlight(serverId: string): Promise<void> {
  try {
    const communityChannelId = await getCommunityChannelId(serverId);
    if (!communityChannelId) return;

    const liveMembers = await getLiveCommunityMembers(serverId);
    if (liveMembers.length === 0) {
      await clearSpotlight(serverId, communityChannelId);
      return;
    }

    const currentSpotlight = await getCurrentSpotlight(serverId);
    const nextIndex = (currentSpotlight?.currentIndex || 0) % liveMembers.length;
    const spotlightMember = liveMembers[nextIndex];

    // Fetch clip if needed (respects 24hr limit)
    await fetchNewClipOnLive(serverId, spotlightMember.discordUserId, spotlightMember.twitchLogin);

    // Get their clip
    const clip = await getCurrentClipForUser(serverId, spotlightMember.discordUserId);

    // Get stream info
    const stream = await getStreamByLogin(spotlightMember.twitchLogin);
    if (!stream) return;

    // Generate spotlight card
    const embed = {
      title: `⭐ COMMUNITY SPOTLIGHT ⭐`,
      description: `**${stream.user_name}** is LIVE!\n\n**${stream.title}**\n🎮 ${stream.game_name}\n👥 ${stream.viewer_count} viewers`,
      url: `https://twitch.tv/${spotlightMember.twitchLogin}`,
      color: 0xFFD700, // Gold
      image: clip?.gifUrl ? {
        url: clip.gifUrl
      } : {
        url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
      },
      footer: {
        text: 'Twitch • Community Spotlight'
      },
      timestamp: new Date().toISOString()
    };

    // Delete old spotlight message if exists
    if (currentSpotlight?.messageId) {
      const { deleteDiscordMessage } = await import('./discord-sync-service');
      await deleteDiscordMessage(serverId, communityChannelId, currentSpotlight.messageId);
    }

    // Post new spotlight
    const messageId = await sendShoutout(serverId, communityChannelId, { embeds: [embed] });

    // Save spotlight state
    await saveSpotlight(serverId, {
      messageId,
      currentIndex: nextIndex + 1,
      userId: spotlightMember.discordUserId,
      lastUpdated: new Date()
    });

    console.log(`[CommunitySpotlight] Spotlighting ${spotlightMember.twitchLogin}`);
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

async function getCommunityChannelId(serverId: string): Promise<string | null> {
  const doc = await db.collection('servers').doc(serverId).get();
  return doc.data()?.communityChannelId || null;
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

async function clearSpotlight(serverId: string, channelId: string) {
  const current = await getCurrentSpotlight(serverId);
  if (current?.messageId) {
    const { deleteDiscordMessage } = await import('./discord-sync-service');
    await deleteDiscordMessage(serverId, channelId, current.messageId);
  }
  await db.collection('servers').doc(serverId)
    .collection('spotlight').doc('current').delete();
}
