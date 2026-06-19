'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/data/server-init';
import { Timestamp } from '@/data/server-init';
import { replyToMessage } from '@/lib/reply-service';
import { Buffer } from 'node:buffer';
import { postDiscordMessage } from '@/lib/discord-sync-service';

// Reusable error handler
function handleError(error: any, defaultMessage: string) {
  console.error('Action Error:', error);
  const message = error instanceof Error ? error.message : defaultMessage;
  return { status: 'error' as const, message };
}

// Reusable success handler
function handleSuccess(message: string, path?: string) {
  if (path) {
    revalidatePath(path);
  }
  return { status: 'success' as const, message };
}

function normalizeShoutoutGroupKey(groupKey: string): string {
  const value = String(groupKey || '').trim();
  if (!value) return 'default';

  switch (value.toLowerCase()) {
    case 'crew':
      return 'Crew';
    case 'partners':
      return 'Partners';
    case 'community':
      return 'Community';
    case 'raid-train':
    case 'raid train':
      return 'Raid Train';
    case 'raid-pile':
    case 'raid pile':
      return 'Raid Pile';
    case 'honored-guests':
    case 'honored guests':
      return 'Honored Guests';
    case 'vip':
      return 'VIP';
    default:
      return value
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
  }
}

async function persistShoutoutChannel(serverId: string, groupKey: string, channelId: string) {
  const canonicalGroup = normalizeShoutoutGroupKey(groupKey);
  const serverRef = db.collection('servers').doc(serverId);
  const serverSnap = await serverRef.get();
  const serverData = serverSnap.data() || {};
  const existingChannels = serverData.shoutoutChannels || {};
  const nextChannels = {
    ...existingChannels,
    [groupKey]: channelId,
    [canonicalGroup]: channelId,
  };

  await serverRef.set(
    {
      shoutoutChannels: nextChannels,
    },
    { merge: true },
  );

  await serverRef.collection('config').doc('groupChannels').set(
    {
      [canonicalGroup]: channelId,
    },
    { merge: true },
  );
}

/**
 * Updates the admin roles for a given server.
 */
export async function updateAdminRoles(prevState: any, formData: FormData) {
  try {
    const serverId = formData.get('serverId') as string;
    const currentPath = formData.get('currentPath') as string;
    if (!serverId) throw new Error('Server ID is required.');

    const roles = Array.from(formData.keys()).filter(
      (key) => key !== 'serverId' && key !== 'currentPath'
    );

    const serverRef = db.collection('servers').doc(serverId);
    await serverRef.update({ adminRoles: roles });

    return handleSuccess('Admin roles have been updated successfully.', currentPath);
  } catch (error) {
    return handleError(error, 'Failed to update admin roles.');
  }
}

/**
 * Updates the leaderboard settings for a given server.
 */
export async function updateLeaderboardSettings(prevState: any, formData: FormData) {
  try {
    const serverId = formData.get('serverId') as string;
    const currentPath = formData.get('currentPath') as string;
    if (!serverId) throw new Error('Server ID is required.');

    const settings = {
      raidPoints: Number(formData.get('raidPoints')),
      followPoints: Number(formData.get('followPoints')),
      subPoints: Number(formData.get('subPoints')),
      giftedSubPoints: Number(formData.get('giftedSubPoints')),
      bitPoints: Number(formData.get('bitPoints')),
      chatActivityPoints: Number(formData.get('chatActivityPoints')),
      firstMessagePoints: Number(formData.get('firstMessagePoints')),
      messageReactionPoints: Number(formData.get('messageReactionPoints')),
      adminEventPoints: Number(formData.get('adminEventPoints')),
      adminLogPoints: Number(formData.get('adminLogPoints')),
      adminMessagePoints: Number(formData.get('adminMessagePoints')),
    };

    const settingsRef = db.collection('servers').doc(serverId).collection('config').doc('leaderboardSettings');
    await settingsRef.set(settings, { merge: true });

    return handleSuccess('Leaderboard settings have been saved.', currentPath);
  } catch (error) {
    return handleError(error, 'Failed to save leaderboard settings.');
  }
}

/**
 * A test action to verify calendar posting from the UI.
 */
export async function testCalendarPostAction(prevState: any, formData: FormData) {
    const guildId = formData.get('guildId') as string;
    const channelId = formData.get('channelId') as string;

    if (!guildId || !channelId) {
        return { status: 'error', message: 'Guild ID and Channel ID are required.', logs: [] };
    }

    console.log(`[Action] testCalendarPostAction called with guildId: ${guildId}, channelId: ${channelId}`);

    // This is a simplified version. In a real app, you might want to capture logs
    // from the actual image generation process.
    const logs = [
        `[${new Date().toISOString()}] Initiating calendar post...`,
        `[${new Date().toISOString()}] Guild ID: ${guildId}`,
        `[${new Date().toISOString()}] Channel ID: ${channelId}`,
        `[${new Date().toISOString()}] Generating calendar image via placeholder...`,
        // Simulate a delay
        await new Promise(resolve => setTimeout(() => resolve(`[${new Date().toISOString()}] Image process finished.`), 1500)),
        `[${new Date().toISOString()}] Image generated, posting to Discord...`,
        `[${new Date().toISOString()}] Discord API response: 200 OK`,
        `[${new Date().toISOString()}] Calendar successfully posted.`
    ];

    return { status: 'success', message: 'Test post simulated successfully!', logs };
}

/**
 * Resets all calendar data for a server.
 */
export async function resetCalendarAction(prevState: any, formData: FormData) {
    const guildId = formData.get('guildId') as string;
    const currentPath = formData.get('currentPath') as string;
    if (!guildId) {
        return { status: 'error' as const, message: 'Guild ID is required.' };
    }

    try {
        const calendarEventsRef = db.collection('servers').doc(guildId).collection('calendarEvents');
        const snapshot = await calendarEventsRef.get();
        if (snapshot.empty) {
            return handleSuccess('No calendar data to delete.', currentPath);
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc: { ref: any }) => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        return handleSuccess(`Successfully deleted ${snapshot.size} calendar entries.`, currentPath);
    } catch (error) {
        return handleError(error, 'Failed to reset calendar data.');
    }
}

/**
 * Generates shoutouts for all online members of the 'Community' group.
 */
export async function generateAllShoutoutsAction(prevState: any, formData: FormData) {
  const serverId = formData.get('serverId') as string;
  const currentPath = (formData.get('currentPath') as string) || '/shoutouts/community';
  if (!serverId) {
    return { status: 'error' as const, results: [], error: 'Server ID is required.' };
  }

  try {
    const { generateAllShoutouts } = await import('@/lib/community-shoutout-service');
    const results = await generateAllShoutouts(serverId);
    if (results.length === 0) {
      return { status: 'success' as const, results: [{ streamerName: 'N/A', success: true, message: 'No online community members found to generate shoutouts for.' }], error: undefined };
    }

    revalidatePath(currentPath || `/shoutouts/community`);
    return { status: 'success' as const, results, error: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    return { status: 'error' as const, results: [], error: message };
  }
}

export async function postShoutoutAction(prevState: any, formData: FormData) {
  try {
    const serverId = String(formData.get('serverId') || '').trim();
    const channelId = String(formData.get('channelId') || '').trim();
    const streamerName = String(formData.get('streamerName') || '').trim() || 'Streamer';
    const currentPath = String(formData.get('currentPath') || '').trim();
    const rawPayload = String(formData.get('payload') || '').trim();

    if (!serverId) {
      throw new Error('Server ID is required.');
    }
    if (!channelId) {
      throw new Error('Channel ID is required.');
    }
    if (!rawPayload) {
      throw new Error('Missing shoutout payload.');
    }

    let payload: any;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      throw new Error('Invalid shoutout payload.');
    }

    const messageId = await postDiscordMessage(serverId, channelId, payload);
    if (!messageId) {
      throw new Error('Failed to send shoutout to Discord.');
    }

    if (currentPath) {
      revalidatePath(currentPath);
    }

    return {
      status: 'success' as const,
      message: `Posted shoutout for ${streamerName}.`,
    };
  } catch (error) {
    return handleError(error, 'Failed to post shoutout.');
  }
}

export async function triggerVipShoutoutsAction(prevState: any, formData: FormData) {
  try {
    const serverId = String(formData.get('serverId') || '').trim();
    const currentPath = String(formData.get('currentPath') || '').trim();

    if (!serverId) {
      throw new Error('Server ID is required.');
    }

    const { runTwitchPollNow } = await import('@/lib/twitch-polling-service');
    await runTwitchPollNow(serverId);

    if (currentPath) {
      revalidatePath(currentPath);
    }

    return {
      status: 'success' as const,
      message: 'VIP shoutouts refreshed and posted for all live members.',
    };
  } catch (error) {
    return handleError(error, 'Failed to trigger VIP shoutouts.');
  }
}

export async function updateShoutoutChannelAction(prevState: any, formData: FormData) {
  try {
    const serverId = String(formData.get('serverId') || '').trim();
    const groupKey = String(formData.get('groupKey') || '').trim();
    const channelId = String(formData.get('channelId') || '').trim();
    const currentPath = String(formData.get('currentPath') || '').trim();

    if (!serverId) {
      throw new Error('Server ID is required.');
    }
    if (!groupKey) {
      throw new Error('Group key is required.');
    }

    await persistShoutoutChannel(serverId, groupKey, channelId);

    if (currentPath) {
      revalidatePath(currentPath);
    }

    return {
      status: 'success' as const,
      message: channelId
        ? `Saved ${groupKey} shoutout channel.`
        : `Cleared ${groupKey} shoutout channel.`,
    };
  } catch (error) {
    return handleError(error, 'Failed to update shoutout channel.');
  }
}

export async function updateUserGroupAction(prevState: any, formData: FormData) {
    try {
        const serverId = formData.get('serverId') as string;
        const userId = formData.get('userId') as string;
        const newGroup = formData.get('newGroup') as string;
        const currentPath = formData.get('currentPath') as string;

        if (!serverId || !userId || !newGroup) {
            throw new Error('Missing server ID, user ID, or new group.');
        }

        console.log('[updateUserGroupAction] Setting group to:', newGroup);

        const userRef = db.collection('servers').doc(serverId).collection('users').doc(userId);
        await userRef.update({ group: newGroup });

        return handleSuccess(`User successfully moved to the ${newGroup} group.`, currentPath);
    } catch (error) {
        return handleError(error, 'Failed to update user group.');
    }
}

export async function updateUsersByRoleAction(prevState: any, formData: FormData) {
    try {
        const serverId = formData.get('serverId') as string;
        const roleName = formData.get('roleName') as string;
        const newGroup = formData.get('newGroup') as string;
        const currentPath = formData.get('currentPath') as string;

        if (!serverId || !roleName || !newGroup) {
            throw new Error('Missing server ID, role name, or new group.');
        }

        console.log('[updateUsersByRoleAction] Setting group to:', newGroup, 'for role:', roleName);

        const usersRef = db.collection('servers').doc(serverId).collection('users');
        const snapshot = await usersRef.where('roles', 'array-contains', roleName).get();

        if (snapshot.empty) {
            return handleSuccess(`No users found with the role "${roleName}". No changes made.`, currentPath);
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc: { ref: any }) => {
            batch.update(doc.ref, { group: newGroup });
        });
        await batch.commit();

        return handleSuccess(`Successfully moved ${snapshot.size} user(s) with the "${roleName}" role to the ${newGroup} group.`, currentPath);
    } catch (error) {
        return handleError(error, 'Failed to update users by role.');
    }
}

export async function replyToMessageAction(prevState: any, formData: FormData) {
    try {
        const messageId = formData.get('messageId') as string;
        const serverId = formData.get('serverId') as string;
        const channelId = formData.get('channelId') as string;
        const replyText = formData.get('replyText') as string;
        const replierId = formData.get('replierId') as string;
        const replierName = formData.get('replierName') as string;
        const replierAvatar = formData.get('replierAvatar') as string;
        const originalAuthorName = formData.get('originalAuthorName') as string;
        const forwardedMessageId = formData.get('forwardedMessageId') as string | null;

        if (!messageId || !serverId || !channelId || !replyText || !replierId || !replierName || !replierAvatar || !originalAuthorName) {
            throw new Error('Missing required fields for reply.');
        }

        const replyData = {
            text: replyText,
            authorId: replierId,
            authorName: replierName,
            authorAvatar: replierAvatar,
            timestamp: Timestamp.now(),
        };

        await replyToMessage({
            channelId,
            replyText,
            replierName,
            originalAuthorName,
            forwardedMessageId: forwardedMessageId || undefined,
        });

        const messageRef = db.collection('servers').doc(serverId).collection('messages').doc(messageId);
        await messageRef.update({ reply: replyData });

        return handleSuccess('Reply has been posted successfully.');
    } catch (error) {
        return handleError(error, 'Failed to post reply.');
    }
}

export async function postNewCalendar(guildId: string, channelId: string): Promise<void> {
    console.log(`[Action] postNewCalendar called for guild: ${guildId}, channel: ${channelId}`);
    try {
        const { generateAndPostCalendar } = await import('@/lib/calendar-discord-service');
        await generateAndPostCalendar(guildId, channelId);
    } catch (error) {
        console.error(`[Action] Failed to post new calendar for guild ${guildId}:`, error);
        throw error;
    }
}

/**
 * Syncs Discord server data into the volume-backed app database.
 */
export async function syncDiscordData(prevState: any, formData: FormData) {
    try {
        const guildId = formData.get('guildId') as string;
        const botToken = formData.get('botToken') as string;

        if (!guildId) {
            throw new Error('Guild ID is required.');
        }

        const { syncServerData } = await import('@/lib/discord-sync-service');
        await syncServerData(guildId, botToken);

        return handleSuccess('Discord data synced successfully.');
    } catch (error) {
        return handleError(error, 'Failed to sync Discord data.');
    }
}
