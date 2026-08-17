import { NextRequest, NextResponse } from 'next/server';
import { mtFixItPublicReply, parseMtFixItCommand } from '@/lib/mtfixit-contract';
import { submitMtFixItOrchestrated } from '@/lib/mtfixit-orchestrator';
import { recordMtFixItOutcome, registerMtFixItDelivery } from '@/lib/mtfixit-delivery';
import { sendDiscordMtFixItMessage } from '@/lib/mtfixit-discord-delivery';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const expectedToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const suppliedToken = String(request.headers.get('x-discord-bot-token') || '').trim();
  if (!expectedToken || !suppliedToken || suppliedToken !== expectedToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const data = body?.root || body || {};
  const description = parseMtFixItCommand(String(data.message || data.content || ''));
  if (description === null) return NextResponse.json({ success: true, skipped: 'not-mtfixit' });

  const channelId = String(data.channelId || '').trim();
  const guildId = String(data.guildId || data.serverId || '').trim();
  const reporterId = String(data.userId || data.author?.id || '').trim();
  const reporter = String(data.userName || data.displayName || data.username || data.author?.username || 'Discord user').trim();
  if (!channelId || !guildId || !reporterId) return NextResponse.json({ error: 'Missing Discord report context' }, { status: 400 });
  if (!description) {
    const sent = await sendDiscordMtFixItMessage(channelId, mtFixItPublicReply('usage'));
    return NextResponse.json({ success: true, commandHandled: 'mtfixit-usage', sent });
  }

  try {
    const submission = await submitMtFixItOrchestrated({
      source: 'discord', reporter, reporterId, description, channelId,
      channelName: String(data.channelName || data.channel?.name || '').trim() || undefined,
      guildId, messageId: String(data.messageId || '').trim() || undefined,
    }, {
      onLifecycle: async (event) => {
        await recordMtFixItOutcome(event.jobId, event.outcome);
        await sendDiscordMtFixItMessage(channelId, mtFixItPublicReply(event.outcome));
      },
    });
    if (submission.disposition === 'submitted') await registerMtFixItDelivery({ jobId: submission.jobId, source: 'discord', reporter, description, channelId, guildId });
    const firstOutcome = submission.disposition === 'submitted' ? 'accepted' : 'failed';
    const sent = await sendDiscordMtFixItMessage(channelId, mtFixItPublicReply(firstOutcome));
    if (firstOutcome === 'failed') await recordMtFixItOutcome(submission.jobId, 'failed');
    return NextResponse.json({ success: true, commandHandled: 'mtfixit', jobId: submission.jobId, sent });
  } catch (error) {
    console.error('[DiscordMtFixIt] submission failed:', error);
    const sent = await sendDiscordMtFixItMessage(channelId, mtFixItPublicReply('failed')).catch(() => null);
    return NextResponse.json({ success: false, commandHandled: 'mtfixit', error: error instanceof Error ? error.message : 'MtFixIt failed', sent }, { status: 502 });
  }
}
