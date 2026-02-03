'use server';

import { db } from '@/firebase/server-init';

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

  private async getBotToken(serverId: string): Promise<string> {
    // Debug what environment variables are actually available
    console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('DISCORD')));
    console.log('DISCORD_BOT_TOKEN exists:', !!process.env.DISCORD_BOT_TOKEN);
    console.log('DISCORD_BOT_TOKEN length:', process.env.DISCORD_BOT_TOKEN?.length);
    
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

      console.log(`Discord sync completed for server ${serverId}`);
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
        roles: member.roles,
        isOnline: false, // Will be updated by Twitch polling
        group: await this.determineGroup(member.roles, serverId),
        lastUpdated: new Date(),
      };

      const userRef = db.collection('servers').doc(serverId).collection('users').doc(member.user.id);
      batch.set(userRef, userData, { merge: true });
    }

    await batch.commit();
    console.log(`Synced ${members.length} members`);
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
    console.log(`Synced ${channels.filter(c => c.type === 0).length} channels`);
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
    console.log(`Synced ${guild.roles.length} roles`);
  }

  private async determineGroup(roleIds: string[], serverId: string): Promise<'VIP' | 'Mountaineer' | 'Train' | 'Pile'> {
    try {
      // Get role mappings from Firestore
      const serverDoc = await db.collection('servers').doc(serverId).get();
      const roleMappings = serverDoc.data()?.roleMappings || {};

      // Check if any of the user's roles are mapped to a group
      for (const roleId of roleIds) {
        if (roleMappings[roleId]) {
          return roleMappings[roleId];
        }
      }

      // Default to Mountaineer if no role mapping found
      return 'Mountaineer';
    } catch (error) {
      console.error('Error determining group:', error);
      return 'Mountaineer';
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
        throw new Error(`Failed to delete message: ${response.statusText}`);
      }

      console.log(`Deleted message ${messageId} from channel ${channelId}`);
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  }

  async editMessage(serverId: string, channelId: string, messageId: string, messageData: any): Promise<void> {
    try {
      const botToken = await this.getBotToken(serverId);
      const response = await fetch(`${this.baseUrl}/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData),
      });

      if (!response.ok) {
        throw new Error(`Failed to edit message: ${response.statusText}`);
      }

      console.log(`Edited message ${messageId} in channel ${channelId}`);
    } catch (error) {
      console.error('Failed to edit message:', error);
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
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const message = await response.json();
      console.log(`Shoutout sent to channel ${channelId}, messageId: ${message.id}`);
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

export async function updateRoleMappings(serverId: string, mappings: Record<string, string>): Promise<void> {
  return discordSyncService.updateRoleMappings(serverId, mappings);
}

export async function deleteDiscordMessage(serverId: string, channelId: string, messageId: string): Promise<void> {
  return discordSyncService.deleteMessage(serverId, channelId, messageId);
}

export async function editDiscordMessage(serverId: string, channelId: string, messageId: string, messageData: any): Promise<void> {
  return discordSyncService.editMessage(serverId, channelId, messageId, messageData);
}

