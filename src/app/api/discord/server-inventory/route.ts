import { NextRequest, NextResponse } from 'next/server';
import { sqliteService } from '@/lib/sqlite-service';
import { forumDiscordRequest, loadForumRule, ensureMirrorThread, mirrorChannelAllowed, removeRestrictedMirror } from '@/lib/discord-forum-mirror';
import { isPublicMirrorSource } from '@/lib/discord-mirror-privacy';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!process.env.DISCORD_BOT_TOKEN || request.headers.get('x-discord-bot-token') !== process.env.DISCORD_BOT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let guildIdForLog = '';
  let channelIdForLog = '';
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Invalid inventory request body' }, { status: 400 });
    }

    const { guildId, channelId } = payload as { guildId?: unknown; channelId?: unknown };
    guildIdForLog = String(guildId || '');
    channelIdForLog = String(channelId || '');
    if (!/^\d{17,20}$/.test(guildIdForLog)) {
      return NextResponse.json({ error: 'Invalid guild' }, { status: 400 });
    }

    const [guild, channels, roles] = await Promise.all([
      forumDiscordRequest('/guilds/' + guildIdForLog),
      forumDiscordRequest('/guilds/' + guildIdForLog + '/channels'),
      forumDiscordRequest('/guilds/' + guildIdForLog + '/roles'),
    ]);

    // Discord should return one guild object and arrays for channels and roles.
    // Validate all three before writing anything so an incomplete upstream response
    // cannot leave a partially updated inventory or fail later with an opaque .map error.
    if (!guild || typeof guild !== 'object' || Array.isArray(guild) || typeof guild.name !== 'string') {
      throw new Error('Discord guild inventory returned an invalid guild payload');
    }
    if (!Array.isArray(channels)) {
      throw new Error('Discord guild inventory returned an invalid channels payload (expected array)');
    }
    if (!Array.isArray(roles)) {
      throw new Error('Discord guild inventory returned an invalid roles payload (expected array)');
    }

    const now = new Date().toISOString();
    sqliteService.setDoc('servers/' + guildIdForLog, {
      serverId: guildIdForLog, serverName: guild.name, name: guild.name, ownerId: guild.owner_id,
      botInstalled: true,
      iconUrl: guild.icon ? 'https://cdn.discordapp.com/icons/' + guildIdForLog + '/' + guild.icon + '.png' : '',
      updatedAt: now,
    }, true);
    sqliteService.setDoc('servers/' + guildIdForLog + '/config/channels', {
      list: channels.map((c: any) => ({ id: c.id, name: c.name, type: c.type })),
      updatedAt: now,
    }, true);
    sqliteService.setDoc('servers/' + guildIdForLog + '/config/roles', {
      list: roles.map((r: any) => r.name),
      detailed: roles.map((r: any) => ({ id: r.id, name: r.name })),
      updatedAt: now,
    }, true);

    const rule = loadForumRule(guildIdForLog);
    if (rule) {
      for (const source of channels) {
        if ([0, 2, 5, 13].includes(Number(source.type)) && !isPublicMirrorSource(guild, source)) {
          await removeRestrictedMirror(rule, source.id);
        }
      }
    }
    const channel = channels.find((c: any) => c.id === channelIdForLog);
    if (
      rule && !rule.paused && channel && isPublicMirrorSource(guild, channel)
      && [0, 2, 5, 13].includes(Number(channel.type))
      && mirrorChannelAllowed(rule, channel.id) && channel.id !== rule.forumChannelId
    ) {
      await ensureMirrorThread(rule, channel);
    }
    return NextResponse.json({ success: true, serverId: guildIdForLog });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inventory update failed';
    console.error(
      `[ServerInventory] Update failed guild=${guildIdForLog || 'unknown'} channel=${channelIdForLog || 'none'}: ${message}`,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
