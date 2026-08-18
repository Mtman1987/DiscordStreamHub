import { NextRequest, NextResponse } from 'next/server';
import { mtFixItPublicReply, parseMtFixItCommand } from '@/lib/mtfixit-contract';
import { submitMtFixItOrchestrated } from '@/lib/mtfixit-orchestrator';
import { recordMtFixItOutcome, registerMtFixItDelivery } from '@/lib/mtfixit-delivery';
import {
  deleteDiscordMtFixItMessage,
  editDiscordMtFixItMessage,
  sendDiscordMtFixItMessage,
} from '@/lib/mtfixit-discord-delivery';
import {
  beginPendingMtFixItConversation,
  consumePendingMtFixItConversation,
} from '@/lib/mtfixit-conversation';

export const dynamic = 'force-dynamic';

const PROMPT = 'Tell me the problem.';
const WORKING = 'Got it. Athena is checking that now. I’ll update this message when I know the outcome.';

export async function POST(request: NextRequest) {
  const expectedToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const suppliedToken = String(request.headers.get('x-discord-bot-token') || '').trim();
  if (!expectedToken || !suppliedToken || suppliedToken !== expectedToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const data = body?.root || body || {};
  const rawMessage = String(data.message || data.content || '').trim();
  const commandDescription = parseMtFixItCommand(rawMessage);

  const channelId = String(data.channelId || '').trim();
  const guildId = String(data.guildId || data.serverId || '').trim();
  const reporterId = String(data.userId || data.author?.id || '').trim();
  const reporter = String(data.userName || data.displayName || data.username || data.author?.username || 'Discord user').trim();
  const sourceMessageId = String(data.messageId || '').trim();
  if (!channelId || !guildId || !reporterId) return NextResponse.json({ error: 'Missing Discord report context' }, { status: 400 });

  const pending = commandDescription === null
    ? await consumePendingMtFixItConversation(channelId, reporterId)
    : null;
  if (commandDescription === null && !pending) return NextResponse.json({ success: true, skipped: 'not-mtfixit' });

  // Bare !mtfixit starts a tiny conversation instead of scolding the user with syntax.
  if (commandDescription === '') {
    await deleteDiscordMtFixItMessage(channelId, sourceMessageId);
    const prompt = await sendDiscordMtFixItMessage(channelId, PROMPT);
    const promptMessageId = String(prompt?.id || '').trim();
    if (!promptMessageId) return NextResponse.json({ success: false, error: 'MtFixIt prompt could not be created' }, { status: 502 });
    await beginPendingMtFixItConversation({ channelId, guildId, reporterId, reporter, promptMessageId });
    return NextResponse.json({ success: true, commandHandled: 'mtfixit-prompt', promptMessageId });
  }

  const description = String(commandDescription === null ? rawMessage : commandDescription).trim();
  if (!description) return NextResponse.json({ success: true, skipped: 'empty-mtfixit-description' });

  // The user-facing chat should contain only Athena's status card. Their command
  // or follow-up sentence is removed once captured.
  await deleteDiscordMtFixItMessage(channelId, sourceMessageId);

  let statusMessageId = String(pending?.promptMessageId || '').trim();
  if (statusMessageId) {
    await editDiscordMtFixItMessage(channelId, statusMessageId, WORKING);
  } else {
    const status = await sendDiscordMtFixItMessage(channelId, WORKING);
    statusMessageId = String(status?.id || '').trim();
  }

  const updateStatus = async (content: string) => {
    if (statusMessageId) return editDiscordMtFixItMessage(channelId, statusMessageId, content);
    const sent = await sendDiscordMtFixItMessage(channelId, content);
    statusMessageId = String(sent?.id || '').trim();
    return sent;
  };

  try {
    const submission = await submitMtFixItOrchestrated({
      source: 'discord', reporter, reporterId, description, channelId,
      channelName: String(data.channelName || data.channel?.name || '').trim() || undefined,
      guildId, messageId: sourceMessageId || undefined,
    }, {
      onLifecycle: async (event) => {
        await recordMtFixItOutcome(event.jobId, event.outcome);
        await updateStatus(mtFixItPublicReply(event.outcome));
      },
    });

    if (submission.disposition === 'submitted') {
      await registerMtFixItDelivery({ jobId: submission.jobId, source: 'discord', reporter, description, channelId, guildId });
      // WORKING is already visible; do not create a second "accepted" message.
      return NextResponse.json({ success: true, commandHandled: 'mtfixit', jobId: submission.jobId, statusMessageId });
    }

    await recordMtFixItOutcome(submission.jobId, 'failed');
    await updateStatus(mtFixItPublicReply('failed'));
    return NextResponse.json({ success: true, commandHandled: 'mtfixit-escalated', jobId: submission.jobId, statusMessageId });
  } catch (error) {
    console.error('[DiscordMtFixIt] submission failed:', error);
    await updateStatus(mtFixItPublicReply('failed')).catch(() => null);
    return NextResponse.json({ success: false, commandHandled: 'mtfixit', error: error instanceof Error ? error.message : 'MtFixIt failed', statusMessageId }, { status: 502 });
  }
}
