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
      title: '📋 Space Mountain Applications',
      description: 'Thank you for your interest in joining our team or becoming a partner!\n\n**Please read the requirements carefully before applying.**',
      color: 0x5865F2,
      fields: [
        {
          name: '🛡️ Mod Team Application',
          value: '**Expectations:**\n• Active chat monitoring & safety\n• Conflict resolution & link management\n• Positive community engagement\n• Reliable presence (few times per week)\n• Staff communication',
          inline: false
        },
        {
          name: '🤝 Partnership Application',
          value: '**Requirements:**\n• Active community/server\n• Willing to promote Raid Train system\n• Enforce 2-hour collision rule\n• Designated point of contact',
          inline: false
        }
      ],
      footer: {
        text: 'Click the buttons below to apply • Applications are reviewed regularly'
      },
      timestamp: new Date().toISOString()
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
                label: 'Apply for Mod Team',
                custom_id: 'apply_mod',
                emoji: { name: '🛡️' }
              },
              {
                type: 2,
                style: 3,
                label: 'Apply for Partnership',
                custom_id: 'apply_partner',
                emoji: { name: '🤝' }
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
    console.error('Error posting applications embed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
