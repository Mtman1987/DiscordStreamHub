import { NextRequest, NextResponse } from 'next/server';

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const embed = {
      title: '🔗 Link Your Twitch Account',
      description: 'Connect your Twitch account to get automatic stream shoutouts when you go live!',
      color: 0x9146FF,
      fields: [
        {
          name: '✨ Benefits',
          value: '• Automatic shoutouts when you stream\n• Updates every 10 minutes\n• Custom GIFs for VIP members\n• Community spotlight features',
          inline: false
        }
      ],
      footer: {
        text: 'Click the button below to get started'
      }
    };

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
                style: 5,
                label: 'Link Twitch Account',
                url: `${appUrl}`,
                emoji: { name: '🎮' }
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error dispatching embed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
