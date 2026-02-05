import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { channelId, message } = await request.json();

    if (!channelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'DISCORD_BOT_TOKEN not configured' }, { status: 500 });
    }

    // Test 1: Simple text message
    const simpleMessage = {
      content: message || '🧪 Test message from DiscordStreamHub'
    };

    console.log('Sending test message to channel:', channelId);
    console.log('Bot token length:', botToken.length);
    console.log('Message payload:', JSON.stringify(simpleMessage));

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(simpleMessage),
    });

    const responseText = await response.text();
    console.log('Discord API response status:', response.status);
    console.log('Discord API response:', responseText);

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `Discord API error: ${response.status}`,
        details: responseText,
        botTokenPresent: !!botToken,
        botTokenLength: botToken.length,
      }, { status: response.status });
    }

    const messageData = JSON.parse(responseText);
    return NextResponse.json({
      success: true,
      messageId: messageData.id,
      channelId: messageData.channel_id,
      content: messageData.content,
      timestamp: messageData.timestamp,
    });

  } catch (error) {
    console.error('Test Discord API error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// Test with embed
export async function PUT(request: NextRequest) {
  try {
    const { channelId } = await request.json();

    if (!channelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'DISCORD_BOT_TOKEN not configured' }, { status: 500 });
    }

    // Test 2: Rich embed message
    const embedMessage = {
      embeds: [{
        title: '🧪 Test Embed from DiscordStreamHub',
        description: 'This is a test embed to verify Discord bot functionality',
        color: 0x9146FF,
        fields: [
          {
            name: '✅ Status',
            value: 'Bot is working correctly',
            inline: true
          },
          {
            name: '🤖 Bot',
            value: 'DiscordStreamHub',
            inline: true
          }
        ],
        footer: {
          text: 'Test Message'
        },
        timestamp: new Date().toISOString()
      }]
    };

    console.log('Sending test embed to channel:', channelId);

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(embedMessage),
    });

    const responseText = await response.text();
    console.log('Discord API response status:', response.status);
    console.log('Discord API response:', responseText);

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `Discord API error: ${response.status}`,
        details: responseText,
      }, { status: response.status });
    }

    const messageData = JSON.parse(responseText);
    return NextResponse.json({
      success: true,
      messageId: messageData.id,
      channelId: messageData.channel_id,
      embedTitle: messageData.embeds[0]?.title,
    });

  } catch (error) {
    console.error('Test Discord embed error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
