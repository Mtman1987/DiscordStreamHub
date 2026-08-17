import { NextRequest, NextResponse } from 'next/server';
import { mtFixItPublicReply, parseMtFixItCommand } from '@/lib/mtfixit-contract';
import { submitMtFixItOrchestrated } from '@/lib/mtfixit-orchestrator';
import { getSpaceMountainIconUrl } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

function athenaPayload(content: string) {
  const icon = String(getSpaceMountainIconUrl() || '').trim();
  return {
    embeds: [{
      author: { name: 'Athena', ...(icon ? { icon_url: icon } : {}) },
      description: content.slice(0, 3900),
      color: 0x66e2ff,
      footer: { text: 'SpaceMountain · MtFixIt' },
    }],
    allowed_mentions: { parse: [] },
  };
}

async function sendDiscordChannelMessage(channelId: string, content: string) {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not configured');
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(athenaPayload(content)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord Athena reply failed: ${response.status} ${await response.text()}`);
  return response.json().catch(() => null);
}

export async function POST(request: NextRequest) {
  const expectedToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const suppliedToken = String(request.headers.get('x-discord-bot-token') || '').trim();
  if (!expectedToken || !suppliedToken || suppliedToken !== expectedToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const data = body?.root || body || {};
  const message = String(data.message || data.content || '');
  const description = parseMtFixItCommand(message);
  if (description === null) return NextResponse.json({ success: true, skipped: 'not-mtfixit' });

  const channelId = String(data.channelId || '').trim();
  const guildId = String(data.guildId || data.serverId || '').trim();
  const reporterId = String(data.userId || data.author?.id || '').trim();
  const reporter = String(data.userName || data.displayName || data.username || data.author?.username || 'Discord user').trim();
  if (!channelId || !guildId || !reporterId) return NextResponse.json({ error: 'Missing Discord report context' }, { status: 400 });

  if (!description) {
    const sent = await sendDiscordChannelMessage(channelId, mtFixItPublicReply('usage'));
    return NextResponse.json({ success: true, commandHandled: 'mtfixit-usage', sent });
  }

  try {
    const submission = await submitMtFixItOrchestrated({
      source: 'discord',
      reporter,
      reporterId,
      description,
      channelId,
      channelName: String(data.channelName || data.channel?.name || '').trim() || undefined,
      guildId,
      messageId: String(data.messageId || '').trim() || undefined,
    }, {
      onLifecycle: async (event) => {
        await sendDiscordChannelMessage(channelId, mtFixItPublicReply(event.outcome));
      },
    });

    const firstOutcome = submission.disposition === 'submitted' ? 'accepted' : 'failed';
    const sent = await sendDiscordChannelMessage(channelId, mtFixItPublicReply(firstOutcome));
    return NextResponse.json({ success: true, commandHandled: 'mtfixit', jobId: submission.jobId, sent });
  } catch (error) {
    console.error('[DiscordMtFixIt] submission failed:', error);
    const sent = await sendDiscordChannelMessage(channelId, mtFixItPublicReply('failed')).catch(() => null);
    return NextResponse.json({ success: false, commandHandled: 'mtfixit', error: error instanceof Error ? error.message : 'MtFixIt failed', sent }, { status: 502 });
  }
}
