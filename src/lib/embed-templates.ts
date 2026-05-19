import { db } from '@/data/server-init';

export interface EmbedTemplates {
  crew: {
    title: string;
    description: string;
    badge: string;
    footer: string;
  };
  partners: {
    title: string;
    description: string;
    badge: string;
    footer: string;
  };
  community: {
    title: string;
    footer: string;
  };
}

const DEFAULT_TEMPLATES: EmbedTemplates = {
  crew: {
    title: '🎬 {username} is LIVE!',
    description: '🌟 **Space Mountain Crew Member** 🌟\n\nOne of our amazing crew members is live! They help keep Space Mountain running smoothly. Show them some love and join the stream!',
    badge: 'Space Mountain Crew',
    footer: 'Twitch • Space Mountain Crew Shoutout'
  },
  partners: {
    title: '⭐ {username} is LIVE!',
    description: '⭐ **Space Mountain Partner** ⭐\n\nOne of our official streaming partners is live! They\'re a valued member of the Space Mountain community. Show them some love and join the stream!',
    badge: 'Official Space Mountain Partner',
    footer: 'Twitch • Space Mountain Partner Shoutout'
  },
  community: {
    title: '🎬 {username} is LIVE!',
    footer: 'Twitch • Mountaineer Shoutout'
  }
};

export async function getEmbedTemplates(serverId: string): Promise<EmbedTemplates> {
  try {
    const doc = await db.collection('servers').doc(serverId).collection('config').doc('embedTemplates').get();
    if (doc.exists) {
      return { ...DEFAULT_TEMPLATES, ...doc.data() } as EmbedTemplates;
    }
  } catch (error) {
    console.error('Error fetching embed templates:', error);
  }
  return DEFAULT_TEMPLATES;
}
