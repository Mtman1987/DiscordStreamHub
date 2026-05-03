import { NextRequest, NextResponse } from 'next/server';
import { getValidDiscordToken } from '@/lib/token-refresh';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId');
    const dataType = searchParams.get('type');
    const discordUserId = searchParams.get('discordUserId') || searchParams.get('userId') || searchParams.get('user_id');

    const tokenData = await getValidDiscordToken(discordUserId || appId || undefined);
    if (!tokenData) {
      return NextResponse.json({ error: 'No Discord token available' }, { status: 401 });
    }

    switch (dataType) {
      case 'user':
        return NextResponse.json({
          user: {
            id: tokenData.userId,
            username: tokenData.username,
            discriminator: tokenData.discriminator,
            avatar: tokenData.avatar,
          }
        });

      case 'guilds':
        // Fetch user's Discord guilds
        const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
          },
        });
        
        if (guildsResponse.ok) {
          const guilds = await guildsResponse.json();
          return NextResponse.json({ guilds });
        }
        break;

      case 'channels':
        const guildId = searchParams.get('guildId');
        if (!guildId) {
          return NextResponse.json({ error: 'Guild ID required for channels' }, { status: 400 });
        }

        const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
          },
        });

        if (channelsResponse.ok) {
          const channels = await channelsResponse.json();
          return NextResponse.json({ channels });
        }
        break;

      default:
        return NextResponse.json({ error: 'Invalid data type' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });

  } catch (error) {
    console.error('Data sharing API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { appId, action, data } = body;

    if (!appId) {
      return NextResponse.json({ error: 'App ID required' }, { status: 400 });
    }

    switch (action) {
      case 'store_room_data':
        const sharedDir = path.join(process.cwd(), 'shared-auth');
        const roomDataPath = path.join(sharedDir, `hearmeout-${appId}-rooms.json`);
        await fs.mkdir(sharedDir, { recursive: true });
        await fs.writeFile(roomDataPath, JSON.stringify(data, null, 2));
        
        return NextResponse.json({ success: true });

      case 'get_room_data':
        try {
          const roomDataPath2 = path.join(process.cwd(), 'shared-auth', `hearmeout-${appId}-rooms.json`);
          const roomData = await fs.readFile(roomDataPath2, 'utf8');
          return NextResponse.json({ data: JSON.parse(roomData) });
        } catch (error) {
          return NextResponse.json({ data: null });
        }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('Data sharing POST API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
