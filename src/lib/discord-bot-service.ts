
'use server';

import { db } from '@/firebase/server-init';
import { isVipGroup } from './group-utils';
import type { DocumentData } from 'firebase-admin/firestore';

/**
 * This service is now in a diagnostic mode.
 * It only posts the mock data it receives and does not have any fallback logic to query Firestore.
 * This isolates its function to simply posting a pre-made payload to Discord.
 */
export async function postAllShoutoutsToDiscord(serverId: string, usersToPost: DocumentData[]): Promise<void> {
  if (!usersToPost || usersToPost.length === 0) {
    console.log('[DiscordBot] No mock users provided to post shoutouts for.');
    return;
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error('[DiscordBot] CRITICAL FAILURE: DISCORD_BOT_TOKEN is not available in the server environment.');
    throw new Error('DISCORD_BOT_TOKEN is not configured on the server.');
  }

  // Hardcoded channel for the test.
  const targetChannelId = '1341946492696526858'; 

  for (const user of usersToPost) {
    if (!user.dailyShoutout) continue;

    try {
      const postResponse = await fetch(`https://discord.com/api/v10/channels/${targetChannelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(user.dailyShoutout),
      });

      if (postResponse.ok) {
        console.log(`[DiscordBot] Successfully posted diagnostic shoutout for ${user.username}`);
      } else {
        const error = await postResponse.text();
        console.error(`[DiscordBot] Failed to post diagnostic shoutout for ${user.username}:`, error);
        // Throw to ensure the failure is visible
        throw new Error(`Discord API error: ${postResponse.status} - ${error}`);
      }

    } catch (error) {
      console.error(`[DiscordBot] Error processing diagnostic shoutout for ${user.username}:`, error);
      // Re-throw the error to make the server action fail.
      throw error;
    }
  }
}

export async function sendDiscordMessage(channelId: string, messageData: any): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    throw new Error('DISCORD_BOT_TOKEN is not configured');
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messageData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord API error: ${response.status} - ${error}`);
  }
}
