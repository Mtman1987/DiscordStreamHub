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

    const embed = {
      title: '⭐ Community Spotlight',
      description: 'Link your Twitch username here to be included in automatic live shoutouts and the rotating community spotlight.',
      color: 0x9146FF,
      fields: [
        {
          name: 'How it works',
          value: 'When you go live, Discord Stream Hub posts your shoutout, keeps it updated, and can feature you in the community spotlight rotation.',
          inline: false
        }
      ],
      footer: {
        text: 'Click the button and type your Twitch username. No website login required.'
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
                style: 1,
                label: 'Link Twitch Username',
                custom_id: 'link_twitch_account',
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
