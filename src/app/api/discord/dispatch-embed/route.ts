import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getChannels } from '@/lib/discord-sync-service';
import { buildSpmtOnboardingButton } from '@/lib/spmt-onboarding-contract';
import { buildSpmtWelcomeEmbed } from '@/lib/spmt-onboarding-embed';

export async function POST(req: NextRequest) {
  try {
    const { serverId, channelId } = await req.json();

    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Missing serverId or channelId' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    const existingLinkingDoc = await db.collection('servers').doc(serverId).collection('config').doc('linkingEmbed').get();
    const existingLinkingEmbed = existingLinkingDoc.exists ? existingLinkingDoc.data() : null;
    const channelName = String((await getChannels(serverId)).find(channel => channel.id === channelId)?.name || '').trim() || null;

    // Get branding
    const brandingDoc = await db.collection('servers').doc(serverId).collection('config').doc('branding').get();
    const branding = brandingDoc.exists ? brandingDoc.data() : {};
    const serverName = branding?.serverName || 'Space Mountain';

    // Get current spotlight user
    const spotlightDoc = await db.collection('servers').doc(serverId).collection('spotlight').doc('current').get();
    let spotlightUser: any = null;
    let spotlightGif: string | null = null;

    if (spotlightDoc.exists) {
      const spotlight = spotlightDoc.data();
      if (spotlight?.userId && spotlight?.twitchLogin) {
        const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(spotlight.userId).get();
        if (userDoc.exists) {
          spotlightUser = { id: userDoc.id, ...userDoc.data() };
        }
        // Get GIF
        try {
          const { getNextGifCdnUrl } = await import('@/lib/gif-rotation-service');
          spotlightGif = await getNextGifCdnUrl(serverId, spotlight.userId, spotlight.twitchLogin);
        } catch {}
      }
    }

    // Fallback: pick a random linked community member if no spotlight
    if (!spotlightUser) {
      const usersSnap = await db.collection('servers').doc(serverId).collection('users')
        .where('twitchLogin', '!=', null).get();
      const eligible = usersSnap.docs
        .map((d: any) => ({ id: d.id, ...d.data() }))
        .filter((u: any) => u.group === 'Honored Guests' || u.group === 'Everyone Else' || u.group === 'Community');
      if (eligible.length > 0) {
        spotlightUser = eligible[Math.floor(Math.random() * eligible.length)];
      }
    }

    const username = spotlightUser?.username || spotlightUser?.twitchLogin || '';
    const twitchLogin = spotlightUser?.twitchLogin || '';
    const avatarUrl = spotlightUser?.avatarUrl || null;

    // Dispatch and refresh share this builder so the welcome wording cannot regress.
    const embed = buildSpmtWelcomeEmbed({
      serverName,
      username,
      twitchLogin,
      avatarUrl,
      spotlightGif,
    });

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed],
        components: [
          {
            type: 1,
            components: [
              buildSpmtOnboardingButton(),
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Discord API error:', error);
      return NextResponse.json({ error: 'Failed to send embed to Discord' }, { status: response.status });
    }

    const msg = await response.json();

    if (existingLinkingEmbed?.messageId && existingLinkingEmbed.messageId !== msg.id) {
      const previousChannelId = existingLinkingEmbed.channelId || channelId;
      await fetch(`https://discord.com/api/v10/channels/${previousChannelId}/messages/${existingLinkingEmbed.messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bot ${botToken}` },
      }).catch(() => {});
    }

    // Save both ID and name. Discord channel IDs can change if a channel is
    // deleted/recreated; the name lets polling safely relocate this embed.
    await db.collection('servers').doc(serverId).collection('config').doc('linkingEmbed').set({
      messageId: msg.id,
      channelId,
      channelName,
      needsDispatch: false,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, messageId: msg.id });
  } catch (error) {
    console.error('Error dispatching embed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
