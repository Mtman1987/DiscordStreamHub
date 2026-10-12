import { NextRequest, NextResponse } from 'next/server';
import { requireGuildManagement } from '@/lib/discord-guild-access';
import { discordApi, ServerConnectionError } from '@/lib/discord-server-connections';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ guildId: string }> }) {
  try {
    const { guildId } = await context.params;
    await requireGuildManagement(request, guildId);
    const channels = await discordApi('/guilds/' + guildId + '/channels', 'Bot ' + (process.env.DISCORD_BOT_TOKEN || ''));
    return NextResponse.json({ channels: channels.map((c: any) => ({ id: c.id, name: c.name, type: c.type })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Channel lookup failed' },
      { status: error instanceof ServerConnectionError ? error.status : 500 });
  }
}
