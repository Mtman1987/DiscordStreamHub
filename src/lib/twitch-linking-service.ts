'use server';

import { db } from '@/firebase/server-init';
import { getUserByLogin } from '@/lib/twitch-api-service';

interface TwitchAccount {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
}

interface UnmatchedUser {
  discordUserId: string;
  username: string;
  displayName: string;
}

class TwitchLinkingService {
  async batchLinkTwitchAccounts(serverId: string): Promise<{
    linked: number;
    notFound: string[];
    errors: string[];
  }> {
    const result = { linked: 0, notFound: [], errors: [] };

    try {
      // Get all users without Twitch accounts
      const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
      const usersToLink: Array<{ id: string; displayName: string; username: string }> = [];

      usersSnapshot.forEach(doc => {
        const data = doc.data();
        if (!data.twitchLogin) {
          usersToLink.push({
            id: doc.id,
            displayName: data.displayName || data.username,
            username: data.username
          });
        }
      });

      console.log(`[TwitchLinking] Attempting to link ${usersToLink.length} users`);

      // Process users in batches to avoid rate limits
      const batchSize = 5;
      for (let i = 0; i < usersToLink.length; i += batchSize) {
        const batch = usersToLink.slice(i, i + batchSize);
        await Promise.all(batch.map(user => this.linkSingleUser(serverId, user, result)));
        
        // Wait 2 seconds between batches to avoid rate limits
        if (i + batchSize < usersToLink.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

    } catch (error) {
      console.error('[TwitchLinking] Error in batch linking:', error);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    return result;
  }

  private async linkSingleUser(
    serverId: string,
    user: { id: string; displayName: string; username: string },
    result: { linked: number; notFound: string[]; errors: string[] }
  ): Promise<void> {
    try {
      // Try multiple methods to find Twitch account
      const twitchAccount = await this.findTwitchAccount(serverId, user.id, user.displayName, user.username);

      if (twitchAccount) {
        // Link the account
        await db.collection('servers').doc(serverId).collection('users').doc(user.id).update({
          twitchLogin: twitchAccount.login,
          twitchDisplayName: twitchAccount.displayName,
          twitchId: twitchAccount.id,
          twitchProfileImageUrl: twitchAccount.profileImageUrl,
          linkedAt: new Date()
        });

        result.linked++;
        console.log(`[TwitchLinking] Linked ${user.displayName} to ${twitchAccount.login}`);
      } else {
        result.notFound.push(user.displayName);
      }

    } catch (error) {
      console.error(`[TwitchLinking] Error linking ${user.displayName}:`, error);
      result.errors.push(`${user.displayName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async findTwitchAccount(serverId: string, discordUserId: string, displayName: string, username: string): Promise<TwitchAccount | null> {
    // Try exact display name match
    const exactMatch = await this.tryTwitchUsername(displayName);
    if (exactMatch) return exactMatch;

    // Try username variations
    const variations = this.generateUsernameVariations(displayName, username);
    for (const variation of variations) {
      const match = await this.tryTwitchUsername(variation);
      if (match) return match;
    }

    return null;
  }

  private async tryTwitchUsername(username: string): Promise<TwitchAccount | null> {
    try {
      // Skip invalid usernames (spaces, special chars, etc)
      if (!/^[a-zA-Z0-9_]{1,25}$/.test(username)) {
        return null;
      }
      
      const user = await getUserByLogin(username.toLowerCase());
      if (user) {
        return {
          id: user.id,
          login: user.login,
          displayName: user.display_name,
          profileImageUrl: user.profile_image_url
        };
      }
    } catch (error) {
      // Username not found or invalid, continue
    }
    return null;
  }

  private generateUsernameVariations(displayName: string, username: string): string[] {
    const variations = new Set<string>();

    // Clean the names
    const cleanDisplay = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Add base variations
    variations.add(cleanDisplay);
    variations.add(cleanUsername);

    // Add common prefixes
    const prefixes = ['the', 'tv', 'twitch', 'streamer', 'gaming'];
    for (const prefix of prefixes) {
      variations.add(`${prefix}${cleanDisplay}`);
      variations.add(`${prefix}${cleanUsername}`);
    }

    // Add common suffixes
    const suffixes = ['tv', 'gaming', 'live', 'stream', 'plays', 'gg'];
    for (const suffix of suffixes) {
      variations.add(`${cleanDisplay}${suffix}`);
      variations.add(`${cleanUsername}${suffix}`);
    }

    // Remove vowels for abbreviations
    const noVowels = cleanDisplay.replace(/[aeiou]/g, '');
    if (noVowels.length > 2) variations.add(noVowels);

    return Array.from(variations);
  }

  async manuallyLinkTwitchAccount(serverId: string, discordUserId: string, twitchLogin: string): Promise<boolean> {
    try {
      // Verify the Twitch account exists
      const twitchUser = await getUserByLogin(twitchLogin);
      if (!twitchUser) {
        throw new Error('Twitch account not found');
      }

      // Link the account
      await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).update({
        twitchLogin: twitchUser.login,
        twitchDisplayName: twitchUser.display_name,
        twitchId: twitchUser.id,
        twitchProfileImageUrl: twitchUser.profile_image_url,
        linkedAt: new Date()
      });

      console.log(`[TwitchLinking] Manually linked ${discordUserId} to ${twitchUser.login}`);
      return true;

    } catch (error) {
      console.error('[TwitchLinking] Error manually linking account:', error);
      return false;
    }
  }

  async getUnmatchedUsers(serverId: string): Promise<UnmatchedUser[]> {
    try {
      const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
      const unmatched: UnmatchedUser[] = [];

      usersSnapshot.forEach(doc => {
        const data = doc.data();
        if (!data.twitchLogin) {
          unmatched.push({
            discordUserId: doc.id,
            username: data.username,
            displayName: data.displayName || data.username
          });
        }
      });

      return unmatched;
    } catch (error) {
      console.error('[TwitchLinking] Error getting unmatched users:', error);
      return [];
    }
  }
}

const twitchLinkingService = new TwitchLinkingService();

export async function batchLinkTwitchAccounts(serverId: string) {
  return twitchLinkingService.batchLinkTwitchAccounts(serverId);
}

export async function manuallyLinkTwitchAccount(serverId: string, discordUserId: string, twitchLogin: string) {
  return twitchLinkingService.manuallyLinkTwitchAccount(serverId, discordUserId, twitchLogin);
}

export async function getUnmatchedUsers(serverId: string) {
  return twitchLinkingService.getUnmatchedUsers(serverId);
}
