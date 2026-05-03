import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const discordServerId = body.discordServerId || body.serverId || body.guildId;
    const discordUserId = body.discordUserId || body.userId || body.ownerId || '';
    const twitchUsername = body.twitchUsername || body.username || '';

    if (!discordServerId) {
      return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });
    }

    // Save basic session info
    db.set('servers', discordServerId, {
      ownerId: discordUserId || '',
      twitchUsername: twitchUsername || '',
      discordUserId,
      discordUsername: body.discordUsername || body.username || '',
      discordAvatar: body.discordAvatar || body.avatar || '',
      serverName: body.serverName || body.name || '',
      iconUrl: body.iconUrl || body.icon || '',
      updatedAt: new Date().toISOString(),
    });

    db.set('userSessions', discordServerId, {
      serverId: discordServerId,
      discordUserId,
      twitchUsername: twitchUsername || '',
      discordUsername: body.discordUsername || body.username || '',
      discordAvatar: body.discordAvatar || body.avatar || '',
      serverName: body.serverName || body.name || '',
      iconUrl: body.iconUrl || body.icon || '',
      updatedAt: new Date().toISOString(),
    });

    // Try to fetch server name from Discord API
    if (BOT_TOKEN) {
      try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${discordServerId}`, {
          headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });
        if (res.ok) {
          const guild = await res.json();
          db.update('servers', discordServerId, {
            serverName: guild.name,
            iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
          });
          db.update('userSessions', discordServerId, {
            serverName: guild.name,
            iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
          });
        }
      } catch {}
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Save session failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
