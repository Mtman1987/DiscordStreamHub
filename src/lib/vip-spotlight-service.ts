'use server';

import { db } from '@/firebase/server-init';
import type { DocumentData } from 'firebase-admin/firestore';
import { getUserByLogin, getStreamByUserId } from './twitch-api-service';
import { generateShoutoutCardGif } from './shoutout-card-service';
import { getUserTodaysClips, manageUserClips } from './clip-management-service';
import { DAILY_CLIP_LIMIT } from './clip-settings';
import { isVipGroup } from './group-utils';

export interface VipSpotlightData {
  streamerName: string;
  streamerLogin: string;
  cardGifUrl: string;
  mp4Url?: string;
  lastUpdated: string;
  streamData: {
    title: string;
    game: string;
    viewers: number;
    avatarUrl: string;
    thumbnailUrl?: string;
    isMature?: boolean;
  };
  clipMeta?: {
    source: 'new' | 'cache';
    recordedAt?: string;
  };
  discordMessageId?: string;
}

export async function updateVipSpotlights(serverId: string): Promise<void> {
  try {
    const usersSnapshot = await db
      .collection('servers')
      .doc(serverId)
      .collection('users')
      .where('isOnline', '==', true)
      .get();

    if (usersSnapshot.empty) {
      console.log('[VipSpotlight] No online users found');
      return;
    }

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      if (!isVipUser(userData)) {
        continue;
      }

      await upsertVipSpotlightForUser(serverId, doc.id, userData);
    }
  } catch (error) {
    console.error('[VipSpotlight] Failed to update VIP spotlights:', error);
  }
}

export async function getVipSpotlight(serverId: string, username: string): Promise<VipSpotlightData | null> {
  try {
    const doc = await db
      .collection('servers')
      .doc(serverId)
      .collection('vipSpotlights')
      .doc(username.toLowerCase())
      .get();

    if (!doc.exists) {
      return null;
    }

    return doc.data() as VipSpotlightData;
  } catch (error) {
    console.error(`[VipSpotlight] Failed to load spotlight for ${username}:`, error);
    return null;
  }
}

async function upsertVipSpotlightForUser(serverId: string, userId: string, userData: DocumentData): Promise<void> {
  const streamerName = userData?.username;

  if (!streamerName) {
    console.log('[VipSpotlight] Skipping VIP without username');
    return;
  }
  const userLookup = { userId, username: streamerName };

  try {
    const twitchUser = await getUserByLogin(streamerName.toLowerCase());
    if (!twitchUser) {
      console.log(`[VipSpotlight] Twitch profile not found for ${streamerName}`);
      return;
    }

    const stream = await getStreamByUserId(twitchUser.id);
    if (!stream) {
      console.log(`[VipSpotlight] ${streamerName} is not live, skipping VIP spotlight`);
      return;
    }
    const isMatureStream = Boolean(stream.is_mature);

    const todaysClips = await getUserTodaysClips(serverId, userLookup);
    const canRecordNewClip = todaysClips.length < DAILY_CLIP_LIMIT;
    let clipSource: 'new' | 'cache' = 'cache';
    let clipToUse = todaysClips.length > 0
      ? todaysClips[todaysClips.length - 1]
      : undefined;

    if (!clipToUse?.gifUrl || canRecordNewClip) {
      const cardResult = await generateShoutoutCardGif({
        streamerName,
        streamTitle: stream.title || userData.topic || 'Live Stream',
        gameName: stream.game_name || 'Just Chatting',
        viewerCount: stream.viewer_count || 0,
        avatarUrl: twitchUser.profile_image_url || userData.avatarUrl || '',
        streamThumbnail: stream.thumbnail_url?.replace('{width}', '640').replace('{height}', '360') || '',
        isLive: true,
        isMature: isMatureStream
      }, serverId);

      if (cardResult) {
        clipSource = 'new';
        clipToUse = {
          gifUrl: cardResult.gifUrl,
          mp4Url: cardResult.mp4Url,
          streamTitle: stream.title,
          gameName: stream.game_name || 'Just Chatting'
        };

        await manageUserClips(serverId, userLookup, {
          gifUrl: cardResult.gifUrl,
          mp4Url: cardResult.mp4Url,
          streamTitle: stream.title,
          gameName: stream.game_name || 'Just Chatting'
        });
      } else if (!clipToUse?.gifUrl) {
        console.log(`[VipSpotlight] Failed to create clip for ${streamerName}`);
        return;
      }
    } else if (todaysClips.length > 0) {
      clipToUse = todaysClips[Math.floor(Math.random() * todaysClips.length)];
    }

    if (!clipToUse?.gifUrl) {
      console.log(`[VipSpotlight] No clip available for ${streamerName}`);
      return;
    }

    const vipSpotlightRef = db
      .collection('servers')
      .doc(serverId)
      .collection('vipSpotlights')
      .doc(streamerName.toLowerCase());

    await vipSpotlightRef.set({
      streamerName,
      streamerLogin: streamerName.toLowerCase(),
      cardGifUrl: clipToUse.gifUrl,
      mp4Url: clipToUse.mp4Url,
      lastUpdated: new Date().toISOString(),
      streamData: {
        title: stream.title || userData.topic || 'Live Stream',
        game: stream.game_name || 'Just Chatting',
        viewers: stream.viewer_count || 0,
        avatarUrl: twitchUser.profile_image_url || userData.avatarUrl || '',
        thumbnailUrl: stream.thumbnail_url?.replace('{width}', '640').replace('{height}', '360') || '',
        isMature: isMatureStream
      },
      clipMeta: {
        source: clipSource,
        recordedAt: new Date().toISOString()
      }
    }, { merge: true });

    console.log(`[VipSpotlight] Updated VIP spotlight for ${streamerName} (${clipSource})`);
  } catch (error) {
    console.error(`[VipSpotlight] Error while updating ${streamerName}:`, error);
  }
}

function isVipUser(userData: DocumentData): boolean {
  return isVipGroup(userData?.group);
}
