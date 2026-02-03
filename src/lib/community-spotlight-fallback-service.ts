'use server';

import { sendDiscordMessage } from './discord-bot-service';
import { getCommunityStats, generateSpotlightHeaderImage, generateSpotlightFooterImage } from './community-spotlight-enhanced-service';

async function getDiscordInvite(): Promise<string | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/discord/create-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (response.ok) {
      const data = await response.json();
      return data.inviteUrl;
    }
  } catch (error) {
    console.error('Failed to create Discord invite:', error);
  }
  return process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || process.env.DISCORD_INVITE_URL || null;
}

export async function postCommunitySpotlightFallback(serverId: string, channelId: string, keepIds?: string[]): Promise<void> {
  try {
    console.log(`[SpotlightFallback] Posting community spotlight fallback to channel ${channelId}`);
    
    // Generate header and footer with current stats
    const stats = await getCommunityStats(serverId);
    
    const [headerImageUrl, footerImageUrl] = await Promise.all([
      generateSpotlightHeaderImage(serverId, stats),
      generateSpotlightFooterImage(serverId, stats)
    ]);

    // Post header image
    if (headerImageUrl) {
      const headerMessage = { content: headerImageUrl };
      const headerMessageId = await sendDiscordMessage(channelId, headerMessage);
      if (headerMessageId && keepIds) keepIds.push(headerMessageId);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Post "no one live" message instead of GIF
    const noLiveMessage = {
      content: "🌙 **No Space Mountain members are currently live**\n\n*Check back soon for live streams from our community!*"
    };
    const noLiveMessageId = await sendDiscordMessage(channelId, noLiveMessage);
    if (noLiveMessageId && keepIds) keepIds.push(noLiveMessageId);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Post footer image
    if (footerImageUrl) {
      const footerMessage = { content: footerImageUrl };
      const footerMessageId = await sendDiscordMessage(channelId, footerMessage);
      if (footerMessageId && keepIds) keepIds.push(footerMessageId);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Get Discord invite URL
    const inviteUrl = await getDiscordInvite();
    
    // Post button message
    const buttonMessage = {
      content: `🚀 **Join Space Mountain Community** 🚀`,
      components: inviteUrl ? [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "JOIN SPACE MOUNTAIN",
          url: inviteUrl
        }]
      }] : []
    };
    const buttonMessageId = await sendDiscordMessage(channelId, buttonMessage);
    if (buttonMessageId && keepIds) keepIds.push(buttonMessageId);

    console.log(`[SpotlightFallback] Posted community spotlight fallback`);
  } catch (error) {
    console.error('[SpotlightFallback] Failed to post fallback:', error);
  }
}