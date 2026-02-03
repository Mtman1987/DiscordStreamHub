'use server';

import { db } from '@/firebase/server-init';
import { getUnmatchedUsers } from '@/lib/twitch-linking-service';

interface ProcessedMemberData {
  totalMembers: number;
  linkedMembers: number;
  unmatchedMembers: number;
  groupCounts: {
    VIP: number;
    'Raid Pile': number;
    'Everyone Else': number;
  };
  unmatchedUsers: Array<{
    discordUserId: string;
    username: string;
    displayName: string;
  }>;
}

class MemberProcessingService {
  async processDiscordMembers(serverId: string): Promise<ProcessedMemberData> {
    try {
      // Get all users from Firestore
      const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();

      let totalMembers = 0;
      let linkedMembers = 0;
      const groupCounts = {
        VIP: 0,
        'Raid Pile': 0,
        'Everyone Else': 0
      };

      usersSnapshot.forEach(doc => {
        const userData = doc.data();
        totalMembers++;

        if (userData.twitchLogin) {
          linkedMembers++;

          // Categorize by group
          const group = userData.group || 'Mountaineer';
          if (group === 'VIP') {
            groupCounts.VIP++;
          } else if (group === 'Pile') {
            groupCounts['Raid Pile']++;
          } else {
            groupCounts['Everyone Else']++;
          }
        }
      });

      // Get unmatched users
      const unmatchedUsers = await getUnmatchedUsers(serverId);

      return {
        totalMembers,
        linkedMembers,
        unmatchedMembers: unmatchedUsers.length,
        groupCounts,
        unmatchedUsers
      };

    } catch (error) {
      console.error('Error processing Discord members:', error);
      throw error;
    }
  }

  async generateUnmatchedUsersEmbed(serverId: string): Promise<any> {
    try {
      const unmatchedUsers = await getUnmatchedUsers(serverId);

      const embed = {
        title: "🔗 Link Your Twitch Account",
        description: "Connect your Twitch account to get shoutouts when you go live! We'll automatically detect when you start streaming and send notifications to the community.",
        color: 0x9146FF, // Twitch purple
        fields: [
          {
            name: "📋 How to Link",
            value: "Click the button below and enter your Twitch username. We'll verify it and link your accounts.",
            inline: false
          },
          {
            name: "🎯 Benefits",
            value: "• Get shoutouts when you go live\n• Join the streamer community\n• Enhanced visibility in the server",
            inline: false
          }
        ],
        footer: {
          text: `${unmatchedUsers.length} members haven't linked yet • Click to get started!`
        }
      };

      const button = {
        type: 2, // Button
        style: 5, // Link style
        label: "Link Twitch Account",
        url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/link-twitch?serverId=${serverId}`
      };

      return {
        embeds: [embed],
        components: [{
          type: 1, // Action row
          components: [button]
        }]
      };

    } catch (error) {
      console.error('Error generating unmatched users embed:', error);
      throw error;
    }
  }

  async generateShoutoutTemplateEmbed(group: 'VIP' | 'Raid Pile' | 'Everyone Else'): Promise<any> {
    try {
      // Create a mock stream object for template generation
      const mockStream = {
        user_name: 'StreamerName',
        title: 'Amazing Game Stream!',
        game_name: 'Popular Game',
        viewer_count: 42,
        thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_streamername-{width}x{height}.jpg'
      };

      let embed;
      switch (group) {
        case 'VIP':
          embed = await this.generateVIPTemplateEmbed(mockStream);
          break;
        case 'Raid Pile':
          embed = this.generateRaidPileTemplateEmbed(mockStream);
          break;
        case 'Everyone Else':
          embed = this.generateEveryoneElseTemplateEmbed(mockStream);
          break;
        default:
          embed = this.generateEveryoneElseTemplateEmbed(mockStream);
      }

      return { embeds: [embed] };

    } catch (error) {
      console.error('Error generating shoutout template embed:', error);
      throw error;
    }
  }

  private async generateVIPTemplateEmbed(stream: any): Promise<any> {
    return {
      title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
      description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n🎬 Featuring recent highlights!`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0xFFD700, // Gold for VIP
      thumbnail: {
        url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
      },
      image: {
        url: 'https://clips-media-assets2.twitch.tv/AT-cm%7C123456789-placeholder-thumbnail.jpg'
      },
      footer: {
        text: 'Twitch • VIP Shoutout ✨'
      },
      timestamp: new Date().toISOString()
    };
  }

  private generateRaidPileTemplateEmbed(stream: any): Promise<any> {
    return {
      title: `🎯 Raid Pile - 🚨 **${stream.user_name}** is now LIVE on Twitch!`,
      description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n\n🎪 Join the raid pile and help build momentum!`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0x4ECDC4, // Teal for raid pile
      thumbnail: {
        url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
      },
      footer: {
        text: 'Twitch • Raid Pile Shoutout'
      },
      timestamp: new Date().toISOString()
    };
  }

  private generateEveryoneElseTemplateEmbed(stream: any): Promise<any> {
    return {
      title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
      description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0x9146FF, // Twitch purple
      thumbnail: {
        url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
      },
      footer: {
        text: 'Twitch • Community Shoutout'
      },
      timestamp: new Date().toISOString()
    };
  }
}

const memberProcessingService = new MemberProcessingService();

export async function processDiscordMembers(serverId: string): Promise<ProcessedMemberData> {
  return memberProcessingService.processDiscordMembers(serverId);
}

export async function generateUnmatchedUsersEmbed(serverId: string): Promise<any> {
  return memberProcessingService.generateUnmatchedUsersEmbed(serverId);
}

export async function generateShoutoutTemplateEmbed(group: 'VIP' | 'Raid Pile' | 'Everyone Else'): Promise<any> {
  return memberProcessingService.generateShoutoutTemplateEmbed(group);
}
