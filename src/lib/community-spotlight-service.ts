
'use server';

import { db } from '@/firebase/server-init';
import { isCommunityGroup } from './group-utils';

const PLACEHOLDER_GIF = 'https://media.tenor.com/yG_mD8bW32EAAAAd/star-wars-celebration-lightsaber.gif';

interface SpotlightData {
  streamerName: string;
  cardGifUrl: string;
  mp4Url?: string;
  lastUpdated: string;
  streamData: {
    title: string;
    game: string;
    viewers: number;
    avatarUrl: string;
    isMature?: boolean;
  };
  clipMeta?: {
    source: 'new' | 'cache';
    recordedAt?: string;
  };
  discordMessageId?: string;
}

export async function updateCommunitySpotlight(serverId: string): Promise<void> {
  try {
    const usersRef = db.collection('servers').doc(serverId).collection('users');
    const snapshot = await usersRef.where('isOnline', '==', true).get();
    
    const communityDocs = snapshot.docs.filter(doc => isCommunityGroup(doc.data().group));
    const onlineMembers = communityDocs
      .map(doc => ({
        username: doc.data().username as string | undefined,
        avatarUrl: doc.data().avatarUrl as string | undefined,
      }))
      .filter(member => Boolean(member.username)) as { username: string; avatarUrl?: string }[];

    if (onlineMembers.length === 0) {
      console.log('[Spotlight] No online community members for spotlight.');
      return;
    }

    // Pick a random online streamer for the spotlight
    const randomMember = onlineMembers[Math.floor(Math.random() * onlineMembers.length)];

    const newSpotlightData: SpotlightData = {
      streamerName: randomMember.username,
      cardGifUrl: PLACEHOLDER_GIF,
      lastUpdated: new Date().toISOString(),
      streamData: {
        title: 'Live Now!',
        game: 'Vibing',
        viewers: 0,
        avatarUrl: randomMember.avatarUrl || '',
      },
    };

    const spotlightRef = db.collection('servers').doc(serverId).collection('spotlight').doc('current');
    await spotlightRef.set(newSpotlightData, { merge: true });

    console.log(`[Spotlight] SIMPLIFIED: Updated community spotlight to ${randomMember.username}`);

  } catch (error) {
    console.error('[Spotlight] SIMPLIFIED: Error updating community spotlight:', error);
  }
}

export async function getCurrentSpotlight(serverId: string): Promise<SpotlightData | null> {
  try {
    const spotlightRef = db.collection('servers').doc(serverId).collection('spotlight').doc('current');
    const doc = await spotlightRef.get();
    
    if (!doc.exists) {
      return null;
    }

    return doc.data() as SpotlightData;
  } catch (error) {
    console.error('Error getting current spotlight:', error);
    return null;
  }
}
