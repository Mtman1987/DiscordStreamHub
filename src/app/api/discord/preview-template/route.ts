import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId, type, templates } = await request.json();

    if (!serverId || !channelId || !type || !templates) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    // Build embed based on type
    let embed: any;
    const username = 'PreviewUser';
    
    if (type === 'crew') {
      embed = {
        title: templates.crew.title.replace('{username}', username),
        description: templates.crew.description.replace('{username}', username),
        color: 0x00D9FF,
        fields: [
          { name: '🎮 Game', value: 'Just Chatting', inline: true },
          { name: '👀 Viewers', value: '42', inline: true },
          { name: '🏷️ Status', value: templates.crew.badge, inline: false }
        ],
        footer: { text: templates.crew.footer },
        timestamp: new Date().toISOString(),
        thumbnail: { url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/default-profile_image-300x300.png' }
      };
    } else if (type === 'partners') {
      embed = {
        title: templates.partners.title.replace('{username}', username),
        description: templates.partners.description.replace('{username}', username),
        color: 0x8B00FF,
        fields: [
          { name: '🎮 Game', value: 'Just Chatting', inline: true },
          { name: '👀 Viewers', value: '42', inline: true },
          { name: '🏷️ Status', value: templates.partners.badge, inline: false }
        ],
        footer: { text: templates.partners.footer },
        timestamp: new Date().toISOString(),
        thumbnail: { url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/default-profile_image-300x300.png' }
      };
    } else if (type === 'community') {
      embed = {
        title: templates.community.title.replace('{username}', username),
        description: 'Check out this awesome stream!',
        color: 0x9146FF,
        fields: [
          { name: '🎮 Game', value: 'Just Chatting', inline: true },
          { name: '👀 Viewers', value: '42', inline: true }
        ],
        footer: { text: templates.community.footer },
        timestamp: new Date().toISOString(),
        thumbnail: { url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/default-profile_image-300x300.png' }
      };
    }

    // Post to Discord
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: '**🔍 Template Preview**',
        embeds: [embed]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Discord API error:', error);
      return NextResponse.json({ error: 'Failed to post to Discord' }, { status: response.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Preview template error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
