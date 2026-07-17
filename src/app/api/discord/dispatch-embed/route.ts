import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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

    // Build embed matching the pinned spotlight format
    const embed: any = {
      author: avatarUrl ? {
        name: `${username} gets shoutouts from ${serverName}!`,
        icon_url: avatarUrl,
        url: `https://twitch.tv/${twitchLogin}`,
      } : undefined,
      title: spotlightUser
        ? `⭐ @${username} gets their shoutouts by ${serverName} — you can too!`
        : `⭐ COMMUNITY SPOTLIGHT ⭐`,
      description: spotlightUser
        ? `Every time **[${username}](https://twitch.tv/${twitchLogin})** goes live, ${serverName} automatically posts a shoutout with their stream info, viewer count, and animated clips.\n\n✨ **Link your Twitch below and you'll get the same treatment!**`
        : `Link your Twitch username to get automatic live shoutouts and be featured in the community spotlight rotation.`,
      url: twitchLogin ? `https://twitch.tv/${twitchLogin}` : undefined,
      color: 0xFFD700,
      thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
      image: spotlightGif ? { url: spotlightGif } : undefined,
      fields: [
        { name: '🎮 Auto Shoutouts', value: 'Posted when you go live', inline: true },
        { name: '🔄 Live Updates', value: 'Every 10 minutes', inline: true },
        { name: '⭐ Spotlight', value: 'Rotating feature', inline: true },
      ],
      footer: {
        text: spotlightUser
          ? `⭐ Community Spotlight • ${username} • Rotates every 10 min`
          : `Link your Twitch to join ${serverName}'s featured streamers`
      },
      timestamp: new Date().toISOString(),
    };

    // Clean undefined fields
    if (!embed.author) delete embed.author;
    if (!embed.url) delete embed.url;
    if (!embed.thumbnail) delete embed.thumbnail;
    if (!embed.image) delete embed.image;

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
              {
                type: 2,
                style: 3,
                label: '🚀 Set Up SPMT + Shoutouts',
                custom_id: 'spmt_onboard',
              },
              {
                type: 2,
                style: 1,
                label: '🔗 Link Twitch Username',
                custom_id: 'link_twitch_account',
              }
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

    // Save as the linking embed so updateLinkingEmbed can refresh it
    await db.collection('servers').doc(serverId).collection('config').doc('linkingEmbed').set({
      messageId: msg.id,
      channelId,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, messageId: msg.id });
  } catch (error) {
    console.error('Error dispatching embed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
