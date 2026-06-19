'use server';

import { db } from '@/lib/db';
import { readFile } from 'fs/promises';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

interface StoredGif {
  clipId: string;
  discordUrl: string;
  messageId: string;
  uploadedAt: string;
}

export async function uploadGifToDiscord(
  gifPath: string,
  clipId: string,
  serverId: string,
  userId: string,
  storageChannelId: string
): Promise<string | null> {
  try {
    const gifBuffer = await readFile(gifPath);
    
    const formData = new FormData();
    const blob = new Blob([gifBuffer], { type: 'image/gif' });
    formData.append('files[0]', blob, `${clipId}.gif`);
    
    const response = await fetch(
      `https://discord.com/api/v10/channels/${storageChannelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      console.error('[DiscordGifStorage] Upload failed:', await response.text());
      return null;
    }

    const message = await response.json();
    const attachment = message.attachments[0];
    
    if (!attachment) return null;

    await db.collection('servers').doc(serverId)
      .collection('users').doc(userId)
      .collection('clips').doc(clipId).set({
        clipId,
        discordUrl: attachment.url,
        messageId: message.id,
        uploadedAt: new Date().toISOString()
      });

    console.log(`[DiscordGifStorage] Uploaded ${clipId} for user ${userId}`);
    return attachment.url;
  } catch (error) {
    console.error('[DiscordGifStorage] Error uploading:', error);
    return null;
  }
}

export async function getStoredGifs(serverId: string, userId: string): Promise<StoredGif[]> {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('clips')
    .orderBy('uploadedAt', 'desc')
    .limit(10)
    .get();

  return snapshot.docs.map((doc: { data: () => any }) => doc.data() as StoredGif);
}

export async function getCurrentGifForUser(serverId: string, userId: string): Promise<StoredGif | null> {
  const gifs = await getStoredGifs(serverId, userId);
  if (gifs.length === 0) return null;

  const stateDoc = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('shoutoutState').doc('current').get();
  
  const currentIndex = stateDoc.data()?.currentClipIndex || 0;
  return gifs[currentIndex % gifs.length];
}

export async function deleteOldestGif(
  serverId: string,
  userId: string,
  storageChannelId: string
): Promise<void> {
  const gifs = await getStoredGifs(serverId, userId);
  if (gifs.length < 10) return;

  const oldest = gifs[gifs.length - 1];
  
  try {
    await fetch(
      `https://discord.com/api/v10/channels/${storageChannelId}/messages/${oldest.messageId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error('[DiscordGifStorage] Error deleting message:', error);
  }

  await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('clips').doc(oldest.clipId).delete();
}
