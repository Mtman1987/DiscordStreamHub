try {
    const { serverId, channelId } = await request.json();

    if (!serverId || !channelId) {
      return NextResponse.json({
        error: 'Server ID and channel ID are required'
      }, { status: 400 });
    }

    // Get unmatched users for the embed
    const unmatchedUsers = await getUnmatchedUsers(serverId);

    // Create the Discord embed
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

    const messageData = {
      embeds: [embed],
      components: [{
        type: 1, // Action row
        components: [button]
      }]
    };

    // Send the embed to Discord
    await sendShoutout(serverId, channelId, messageData);

    return NextResponse.json({
      success: true,
      message: `Embed sent to channel ${channelId} with ${unmatchedUsers.length} unmatched users`
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/dispatch-embed]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
=======
export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId } = await request.json();

    if (!serverId) {
      return NextResponse.json({
        error: 'Server ID is required'
      }, { status: 400 });
    }

    // Get unmatched users for the embed
    const unmatchedUsers = await getUnmatchedUsers(serverId);

    // Create the Discord embed
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

    const messageData = {
      embeds: [embed],
      components: [{
        type: 1, // Action row
        components: [button]
      }]
    };

    // If channelId is provided, send to specific channel, otherwise send to general channel
    const targetChannelId = channelId || await getDefaultChannelId(serverId);
    if (!targetChannelId) {
      return NextResponse.json({
        error: 'No channel ID provided and no default channel found'
      }, { status: 400 });
    }

    // Send the embed to Discord
    await sendShoutout(serverId, targetChannelId, messageData);

    return NextResponse.json({
      success: true,
      message: `Embed sent to channel ${targetChannelId} with ${unmatchedUsers.length} unmatched users`
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/dispatch-embed]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function getDefaultChannelId(serverId: string): Promise<string | null> {
  // This would need to be implemented to get a default channel
  // For now, return null to require explicit channelId
  return null;
}
