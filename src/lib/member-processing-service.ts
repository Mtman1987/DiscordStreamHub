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

          // Categorize by group (case-insensitive)
          const group = userData.group || 'Mountaineer';
          const groupLower = group.toLowerCase();
          if (groupLower === 'vip') {
            groupCounts.VIP++;
          } else if (groupLower === 'pile' || groupLower === 'raid pile') {
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

  async generateShoutoutTemplateEmbed(group: 'Raid Pile' | 'Everyone Else' | 'Honored Guests' | 'Partners' | 'Crew', userData?: any): Promise<any> {
    try {
      const twitchClientId = process.env.TWITCH_CLIENT_ID;
      const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
      
      let mockStream;
      let profileImageUrl = 'https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-70x70.png';

      if (twitchClientId && twitchClientSecret) {
        try {
          // Get OAuth token
          const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `client_id=${twitchClientId}&client_secret=${twitchClientSecret}&grant_type=client_credentials`
          });
          const tokenData = await tokenResponse.json();
          const accessToken = tokenData.access_token;

          // Try daddy_gandy first, then any live stream
          let streamsResponse = await fetch('https://api.twitch.tv/helix/streams?user_login=daddy_gandy', {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Client-Id': twitchClientId
            }
          });
          let streamsData = await streamsResponse.json();
          
          // If daddy_gandy not live, get any live stream
          if (!streamsData.data || streamsData.data.length === 0) {
            streamsResponse = await fetch('https://api.twitch.tv/helix/streams?first=1', {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': twitchClientId
              }
            });
            streamsData = await streamsResponse.json();
          }
          
          if (streamsData.data && streamsData.data.length > 0) {
            const stream = streamsData.data[0];
            
            // Get user profile image
            const userResponse = await fetch(`https://api.twitch.tv/helix/users?id=${stream.user_id}`, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': twitchClientId
              }
            });
            const userData = await userResponse.json();
            
            if (userData.data && userData.data.length > 0) {
              profileImageUrl = userData.data[0].profile_image_url;
            }
            
            mockStream = {
              user_name: stream.user_name,
              title: stream.title,
              game_name: stream.game_name,
              viewer_count: stream.viewer_count,
              thumbnail_url: stream.thumbnail_url,
              profile_image_url: profileImageUrl
            };
          }
        } catch (apiError) {
          console.error('Error fetching live stream:', apiError);
        }
      }
      
      // Fallback to mock data if API fails
      if (!mockStream) {
        mockStream = {
          user_name: 'Mtman1987',
          title: 'Epic Gaming Session - Come hang out!',
          game_name: 'Just Chatting',
          viewer_count: 15,
          thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_mtman1987-{width}x{height}.jpg',
          profile_image_url: profileImageUrl
        };
      }

      let result;
      switch (group) {
        case 'Crew':
          result = await this.generateCrewTemplateEmbedWithButtons(mockStream, userData);
          break;
        case 'Partners':
          result = await this.generatePartnersTemplateEmbedWithButtons(mockStream, userData);
          break;
        case 'Raid Pile':
          result = { embeds: [this.generateRaidPileTemplateEmbed(mockStream)] };
          break;
        case 'Honored Guests':
          result = { embeds: [this.generateHonoredGuestsTemplateEmbed(mockStream)] };
          break;
        case 'Everyone Else':
          result = { embeds: [this.generateEveryoneElseTemplateEmbed(mockStream)] };
          break;
        default:
          result = { embeds: [this.generateEveryoneElseTemplateEmbed(mockStream)] };
      }

      return result;

    } catch (error) {
      console.error('Error generating shoutout template embed:', error);
      throw error;
    }
  }

  private generateCrewDividerEmbed(): any {
    return {
      image: {
        url: process.env.CREW_BANNER_GIF_URL || 'https://via.placeholder.com/1920x120/00D9FF/FFFFFF?text=SPACE+MOUNTAIN+CREW'
      },
      color: 0x00D9FF
    };
  }

  async generateCrewShoutoutsWithDividers(crewMembers: any[]): Promise<any[]> {
    const embeds = [];
    
    for (let i = 0; i < crewMembers.length; i++) {
      // Add crew member shoutout
      const shoutout = await this.generateCrewTemplateEmbed(crewMembers[i].stream, crewMembers[i].userData);
      embeds.push(shoutout);
      
      // Add divider after each crew member except the last one
      if (i < crewMembers.length - 1) {
        embeds.push(this.generateCrewDividerEmbed());
      }
    }
    
    return embeds;
  }

  private async generateCrewTemplateEmbed(stream: any, userData?: any): Promise<any> {
    const discordLink = userData?.partnerDiscordLink || 'https://discord.gg/spacemountain';
    
    return {
      author: {
        name: `${stream.user_name} is now LIVE!`,
        icon_url: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif',
        url: `https://twitch.tv/${stream.user_name.toLowerCase()}`
      },
      title: `🚀 **${stream.title}**`,
      description: `🌟 **Space Mountain Crew Member** 🌟\n\nOne of our amazing crew members is live! They help keep Space Mountain running smoothly. Show them some love and join the stream!`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0x00D9FF,
      fields: [
        {
          name: '🎮 Playing',
          value: stream.game_name,
          inline: true
        },
        {
          name: '👥 Viewers',
          value: stream.viewer_count.toString(),
          inline: true
        },
        {
          name: '🚀 Crew Status',
          value: 'Space Mountain Crew',
          inline: true
        }
      ],
      thumbnail: {
        url: stream.profile_image_url
      },
      image: {
        url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
      },
      footer: {
        text: 'Twitch • Crew Member Shoutout'
      },
      timestamp: new Date().toISOString()
    };
  }

  private async generateCrewTemplateEmbedWithButtons(stream: any, userData?: any): Promise<any> {
    const embed = await this.generateCrewTemplateEmbed(stream, userData);
    const discordLink = userData?.partnerDiscordLink || 'https://discord.gg/spacemountain';
    
    return {
      embeds: [embed],
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'Watch on Twitch',
            url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
            emoji: { name: '📺' }
          },
          {
            type: 2,
            style: 5,
            label: 'Join Their Discord',
            url: discordLink,
            emoji: { name: '💬' }
          }
        ]
      }]
    };
  }

  private async generatePartnersTemplateEmbed(stream: any, userData?: any): Promise<any> {
    const discordLink = userData?.partnerDiscordLink || 'https://discord.gg/spacemountain';
    
    return {
      author: {
        name: `${stream.user_name} is now LIVE!`,
        icon_url: 'https://cdn.discordapp.com/emojis/1284931162896334929.gif',
        url: `https://twitch.tv/${stream.user_name.toLowerCase()}`
      },
      title: `🌌 **${stream.title}**`,
      description: `⭐ **Space Mountain Partner** ⭐\n\nOne of our official streaming partners is live! They're a valued member of the Space Mountain community. Show them some love and join the stream!`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0x8B00FF,
      fields: [
        {
          name: '🎮 Playing',
          value: stream.game_name,
          inline: true
        },
        {
          name: '👥 Viewers',
          value: stream.viewer_count.toString(),
          inline: true
        },
        {
          name: '🌟 Partner Status',
          value: 'Official Space Mountain Partner',
          inline: true
        }
      ],
      thumbnail: {
        url: stream.profile_image_url
      },
      image: {
        url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
      },
      footer: {
        text: 'Twitch • Space Mountain Partner Shoutout'
      },
      timestamp: new Date().toISOString()
    };
  }

  private async generatePartnersTemplateEmbedWithButtons(stream: any, userData?: any): Promise<any> {
    const embed = await this.generatePartnersTemplateEmbed(stream, userData);
    const discordLink = userData?.partnerDiscordLink || 'https://discord.gg/spacemountain';
    
    return {
      embeds: [embed],
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'Watch on Twitch',
            url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
            emoji: { name: '📺' }
          },
          {
            type: 2,
            style: 5,
            label: 'Join Their Discord',
            url: discordLink,
            emoji: { name: '💬' }
          }
        ]
      }]
    };
  }

  private generateRaidPileTemplateEmbed(stream: any): any {
    return {
      title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
      description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0x4ECDC4,
      thumbnail: {
        url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
      },
      image: {
        url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
      },
      footer: {
        text: 'Twitch • Raid Pile Shoutout 🎯'
      },
      timestamp: new Date().toISOString()
    };
  }

  private generateHonoredGuestsTemplateEmbed(stream: any): any {
    return {
      title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
      description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}\n\n✨ *Honored Guest*`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0xFF8C00,
      thumbnail: {
        url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
      },
      image: {
        url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
      },
      footer: {
        text: 'Twitch • Honored Guest'
      },
      timestamp: new Date().toISOString()
    };
  }

  private generateEveryoneElseTemplateEmbed(stream: any): any {
    return {
      title: `🚨 **${stream.user_name}** is now LIVE on Twitch!`,
      description: `**${stream.title}**\n🎮 Playing: ${stream.game_name}\n👥 Viewers: ${stream.viewer_count}`,
      url: `https://twitch.tv/${stream.user_name.toLowerCase()}`,
      color: 0x9146FF,
      thumbnail: {
        url: 'https://static-cdn.jtvnw.net/ttv-boxart/twitch-logo.png'
      },
      image: {
        url: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
      },
      footer: {
        text: 'Twitch • Mountaineer Shoutout'
      },
      timestamp: new Date().toISOString()
    };
  }
}

const memberProcessingService = new MemberProcessingService();

export async function generateCrewShoutoutsWithDividers(crewMembers: any[]): Promise<any[]> {
  return memberProcessingService.generateCrewShoutoutsWithDividers(crewMembers);
}

export async function processDiscordMembers(serverId: string): Promise<ProcessedMemberData> {
  return memberProcessingService.processDiscordMembers(serverId);
}

export async function generateUnmatchedUsersEmbed(serverId: string): Promise<any> {
  return memberProcessingService.generateUnmatchedUsersEmbed(serverId);
}

export async function generateShoutoutTemplateEmbed(group: 'Raid Pile' | 'Everyone Else' | 'Honored Guests' | 'Partners' | 'Crew', userData?: any): Promise<any> {
  return memberProcessingService.generateShoutoutTemplateEmbed(group, userData);
}

export async function getUnmatchedUsers(serverId: string) {
  const { getUnmatchedUsers: getUsers } = await import('@/lib/twitch-linking-service');
  return getUsers(serverId);
}
