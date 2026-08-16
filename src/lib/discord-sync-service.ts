'use server';

import { db } from '@/data/server-init';
import { getDiscordDebugEnvLogsEnabled } from '@/lib/runtime-config';
import { toCanonicalGroup } from '@/lib/group-utils';

interface DiscordMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  roles: string[];
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
}

class DiscordSyncService {
  private baseUrl = 'https://discord.com/api/v10';
  private readonly editRetryDelaysMs = [300, 900];

  private isExpectedEditLifecycleError(errorText: string): boolean {
    return /Maximum number of edits to messages older than 1 hour reached|code["']?\s*:\s*30046|30046|Unknown Message/i.test(errorText);
  }

  private async waitForEditRetry(response: Response, attempt: number): Promise<void> {
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    const fallbackMs = this.editRetryDelaysMs[Math.min(attempt, this.editRetryDelaysMs.length - 1)];
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(5_000, retryAfterSeconds * 1_000)
      : fallbackMs;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private async getBotToken(serverId: string): Promise<string> {
    if (getDiscordDebugEnvLogsEnabled()) {
      console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('DISCORD')));
      console.log('DISCORD_BOT_TOKEN exists:', !!process.env.DISCORD_BOT_TOKEN);
      console.log('DISCORD_BOT_TOKEN length:', process.env.DISCORD_BOT_TOKEN?.length);
    }

    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error(`DISCORD_BOT_TOKEN environment variable not found. Available: ${Object.keys(process.env).join(', ')}`);
    }
    return token;
  }

  private async makeDiscordRequest(serverId: string, endpoint: string): Promise<any> {
    const botToken = await this.getBotToken(serverId);
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Discord API error: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async syncServerData(serverId: string, botToken?: string): Promise<void> {
    try {
      // Set bot token if provided
      if (botToken) {
        process.env.DISCORD_BOT_TOKEN = botToken;
      }

      // Sync members, channels, and roles
      await Promise.all([
        this.syncMembers(serverId),
        this.syncChannels(serverId),
        this.syncRoles(serverId),
      ]);

      // Update sync timestamp
      await db.collection('servers').doc(serverId).update({
        lastSync: new Date(),
      });

    } catch (error) {
      console.error('Discord sync failed:', error);
      throw error;
    }
  }

  private async syncMembers(serverId: string): Promise<void> {
    const members = await this.makeDiscordRequest(serverId, `/guilds/${serverId}/members?limit=1000`);
    const batch = db.batch();

    for (const member of members) {
      const userData = {
        discordUserId: member.user.id,
        username: member.user.username,
        displayName: member.nick || member.user.display_name || member.user.username,
        avatarUrl: member.user.avatar 
          ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${member.user.discriminator % 5}.png`,
        discordJoinedAt: member.joined_at || null,
        roles: member.roles,
        isOnline: false, // Will be updated by Twitch polling
        group: await this.determineGroup(member.roles, serverId),
        lastUpdated: new Date(),
      };

      const userRef = db.collection('servers').doc(serverId).collection('users').doc(member.user.id);
      batch.set(userRef, userData, { merge: true });
    }

    await batch.commit();
  }

  private async syncChannels(serverId: string): Promise<void> {
    const channels = await this.makeDiscordRequest(serverId, `/guilds/${serverId}/channels`);
    const batch = db.batch();

    for (const channel of channels) {
      if (channel.type === 0) { // Text channels only
        const channelData = {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          position: channel.position,
          parentId: channel.parent_id,
        };

        const channelRef = db.collection('servers').doc(serverId).collection('channels').doc(channel.id);
        batch.set(channelRef, channelData);
      }
    }

    await batch.commit();
  }

  private async syncRoles(serverId: string): Promise<void> {
    const guild = await this.makeDiscordRequest(serverId, `/guilds/${serverId}`);
    const batch = db.batch();

    for (const role of guild.roles) {
      const roleData = {
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        permissions: role.permissions,
      };

      const roleRef = db.collection('servers').doc(serverId).collection('roles').doc(role.id);
      batch.set(roleRef, roleData);
    }

    await batch.commit();
  }

  private async determineGroup(roleIds: string[], serverId: string): Promise<string> {
    try {
      // Get role mappings from the app database.
      const serverDoc = await db.collection('servers').doc(serverId).get();
      const roleMappings = serverDoc.data()?.roleMappings || {};

      // Check if any of the user's roles are mapped to a group
      for (const roleId of roleIds) {
        if (roleMappings[roleId]) {
          return toCanonicalGroup(roleMappings[roleId]) || String(roleMappings[roleId]);
        }
      }

      // Default to Everyone Else when no role mapping is present.
      return 'Everyone Else';
    } catch (error) {
      console.error('Error determining group:', error);
      return 'Everyone Else';
    }
  }

  async deleteMessage(serverId: string, channelId: string, messageId: string): Promise<void> {
    try {
      const botToken = await this.getBotToken(serverId);
      const response = await fetch(`${this.baseUrl}/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bot ${botToken}`,
        },
      });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to delete message ${messageId} in ${channelId}: ${response.status} ${errorText}`);
      }

    } catch (error) {
      console.error('Failed to delete message:', error);
      throw error;
    }
  }

  async editMessage(serverId: string, channelId: string, messageId: string, messageData: any): Promise<void> {
    try {
      const botToken = await this.getBotToken(serverId);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(`${this.baseUrl}/channels/${channelId}/messages/${messageId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messageData),
        });

        if (response.ok) {
          return;
        }

        const errorText = await response.text().catch(() => response.statusText);
        if (this.isExpectedEditLifecycleError(errorText)) {
          console.warn(`Discord edit needs repost for ${messageId} in ${channelId}: ${response.status} ${errorText}`);
          throw new Error(`Failed to edit message ${messageId} in ${channelId}: ${response.status} ${errorText}`);
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          console.warn(`Discord edit transient failure for ${messageId} in ${channelId}: ${response.status}; retry ${attempt + 1}/2`);
          await this.waitForEditRetry(response, attempt);
          continue;
        }

        throw new Error(`Failed to edit message ${messageId} in ${channelId}: ${response.status} ${errorText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isExpectedEditLifecycleError(message)) {
        throw error;
      }
      console.error('Failed to edit message:', error);
      throw error;
    }
  }

  async sendShoutout(serverId: string, channelId: string, shoutoutData: any): Promise<string | null> {
    try {
      const botToken = await this.getBotToken(serverId);
      const response = await fetch(`${this.baseUrl}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(shoutoutData),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        console.error('[DiscordSync] sendShoutout failed:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
          payloadPreview: {
            hasEmbeds: Array.isArray(shoutoutData?.embeds) && shoutoutData.embeds.length > 0,
            embedCount: Array.isArray(shoutoutData?.embeds) ? shoutoutData.embeds.length : 0,
            hasComponents: Array.isArray(shoutoutData?.components) && shoutoutData.components.length > 0,
          },
        });
        throw new Error(`Failed to send message: ${response.status} ${errorText}`);
      }

      const message = await response.json();
      return message.id;
    } catch (error) {
      console.error('Failed to send shoutout:', error);
      return null;
    }
  }

  async getChannels(serverId: string): Promise<DiscordChannel[]> {
    try {
      const configDoc = await db.collection('servers').doc(serverId).collection('config').doc('channels').get();
      if (!configDoc.exists) {
        return [];
      }
      const data = configDoc.data();
      return data?.list || [];
    } catch (error) {
      console.error('Error fetching channels:', error);
      return [];
    }
  }

  async getRoles(serverId: string): Promise<string[]> {
    try {
      const configDoc = await db.collection('servers').doc(serverId).collection('config').doc('roles').get();
      if (!configDoc.exists) {
        return [];
      }
      const data = configDoc.data();
      return data?.list || [];
    } catch (error) {
      console.error('Error fetching roles:', error);
      return [];
    }
  }

  async updateRoleMappings(serverId: string, mappings: Record<string, string>): Promise<void> {
    await db.collection('servers').doc(serverId).update({
      roleMappings: mappings,
      lastMappingUpdate: new Date(),
    });
  }

  async getRoleMappings(serverId: string): Promise<Record<string, string>> {
    try {
      const doc = await db.collection('servers').doc(serverId).get();
      return doc.data()?.roleMappings || {};
    } catch (error) {
      console.error('Error fetching role mappings:', error);
      return {};
    }
  }
}

const discordSyncService = new DiscordSyncService();

export async function syncServerData(serverId: string, botToken?: string): Promise<void> {
  return discordSyncService.syncServerData(serverId, botToken);
}

export async function sendShoutout(serverId: string, channelId: string, shoutoutData: any): Promise<string | null> {
  return discordSyncService.sendShoutout(serverId, channelId, shoutoutData);
}

export async function getChannels(serverId: string): Promise<DiscordChannel[]> {
  return discordSyncService.getChannels(serverId);
}

export async function getRoles(serverId: string): Promise<string[]> {
  return discordSyncService.getRoles(serverId);
}

export async function getRoleMappings(serverId: string): Promise<Record<string, string>> {
  return discordSyncService.getRoleMappings(serverId);
}

export async function updateRoleMappings(serverId: string, mappings: Record<string, string>): Promise<void> {
  return discordSyncService.updateRoleMappings(serverId, mappings);
}

export async function deleteDiscordMessage(serverId: string, channelId: string, messageId: string): Promise<void> {
  return discordSyncService.deleteMessage(serverId, channelId, messageId);
}

export async function editDiscordMessage(serverId: string, channelId: string, messageId: string, messageData: any): Promise<void> {
  return discordSyncService.editMessage(serverId, channelId, messageId, messageData);
}

export async function postDiscordMessage(serverId: string, channelId: string, messageData: any): Promise<string | null> {
  return discordSyncService.sendShoutout(serverId, channelId, messageData);
}

export async function syncChannelsAndRoles(serverId: string): Promise<void> {
  try {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) return;

    const [channelsData, guildData] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${serverId}/channels`, {
        headers: { 'Authorization': `Bot ${botToken}` },
      }).then(r => r.ok ? r.json() : []),
      fetch(`https://discord.com/api/v10/guilds/${serverId}`, {
        headers: { 'Authorization': `Bot ${botToken}` },
      }).then(r => r.ok ? r.json() : null),
    ]);

    if (channelsData.length > 0) {
      await db.collection('servers').doc(serverId).collection('config').doc('channels').set({
        list: channelsData.map((ch: any) => ({ id: ch.id, name: ch.name, type: ch.type })),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    if (guildData?.roles) {
      await db.collection('servers').doc(serverId).collection('config').doc('roles').set({
        list: guildData.roles.map((r: any) => r.name),
        detailed: guildData.roles.map((r: any) => ({ id: r.id, name: r.name })),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  } catch (error) {
    console.error('[DiscordSync] syncChannelsAndRoles failed:', error);
  }
}

export async function getUserRolesAndGroup(
  serverId: string,
  userId: string
): Promise<{ roles: string[]; group: string }> {
  const existingUser = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
  const existingData = existingUser.data();
  const existingRoles = Array.isArray(existingData?.roles) ? existingData.roles : [];
  const existingGroup = existingData?.group;

  if (existingRoles.length > 0 && typeof existingGroup === 'string') {
    return {
      roles: existingRoles,
      group: existingGroup,
    };
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return { roles: existingRoles, group: 'Everyone Else' };
  }

  const response = await fetch(`https://discord.com/api/v10/guilds/${serverId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!response.ok) {
    console.warn(`[DiscordSync] Failed to fetch member ${userId} in ${serverId}: ${response.status}`);
    return { roles: existingRoles, group: 'Everyone Else' };
  }

  const member = await response.json();
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const group = await discordSyncService['determineGroup'](roles, serverId);

  return { roles, group };
}
