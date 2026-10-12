import { NextRequest, NextResponse } from 'next/server';
import { sqliteService } from '@/lib/sqlite-service';
import { forumDiscordRequest, loadForumRule, ensureMirrorThread, mirrorChannelAllowed } from '@/lib/discord-forum-mirror';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  if (!process.env.DISCORD_BOT_TOKEN || request.headers.get('x-discord-bot-token') !== process.env.DISCORD_BOT_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { guildId, channelId } = await request.json();
    if (!/^\d{17,20}$/.test(String(guildId || ''))) return NextResponse.json({ error: 'Invalid guild' }, { status: 400 });
    const [guild, channels, roles] = await Promise.all([
      forumDiscordRequest('/guilds/' + guildId), forumDiscordRequest('/guilds/' + guildId + '/channels'), forumDiscordRequest('/guilds/' + guildId + '/roles'),
    ]);
    const now = new Date().toISOString();
    sqliteService.setDoc('servers/' + guildId, { serverId: guildId, serverName: guild.name, name: guild.name, ownerId: guild.owner_id, botInstalled: true,
      iconUrl: guild.icon ? 'https://cdn.discordapp.com/icons/' + guildId + '/' + guild.icon + '.png' : '', updatedAt: now }, true);
    sqliteService.setDoc('servers/' + guildId + '/config/channels', { list: channels.map((c: any) => ({ id: c.id, name: c.name, type: c.type })), updatedAt: now }, true);
    sqliteService.setDoc('servers/' + guildId + '/config/roles', { list: roles.map((r: any) => r.name), detailed: roles.map((r: any) => ({ id: r.id, name: r.name })), updatedAt: now }, true);
    const rule = loadForumRule(guildId);
    const channel = channels.find((c: any) => c.id === channelId);
    if (rule && channel && [0, 2, 5, 13].includes(Number(channel.type)) && mirrorChannelAllowed(rule, channel.id) && channel.id !== rule.forumChannelId) {
      await ensureMirrorThread(rule, channel);
    }
    return NextResponse.json({ success: true, serverId: guildId });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Inventory update failed' }, { status: 500 }); }
}
