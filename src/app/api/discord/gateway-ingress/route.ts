import { NextRequest, NextResponse } from 'next/server';
import { getChatTagApiBase, getDiscordClientId, getHearMeOutUrl, getStreamweaverUrl } from '@/lib/runtime-config';
import { normalizePublicSpmtCommand, type PublicSpmtCommand } from '@/lib/discord-spmt-command';
import { parseMtFixItCommand } from '@/lib/mtfixit-contract';

export const dynamic = 'force-dynamic';

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  timer.unref?.();
  return controller.signal;
}

function trace(traceId: string, stage: string, details: Record<string, unknown> = {}) {
  console.log(`[DiscordGatewayIngress] ${JSON.stringify({ traceId, stage, ...details })}`);
}

async function postJson(url: string, body: any, headers: Record<string, string> = {}, timeoutMs = 10_000) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs),
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, durationMs: Date.now() - startedAt, payload };
  } catch (error) {
    return { ok: false, status: 0, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

function withForwardedSpmtMessage(body: any, command: PublicSpmtCommand) {
  if (!command.forwardMessage) return body;
  if (body?.root && typeof body.root === 'object') {
    return { ...body, root: { ...body.root, message: command.forwardMessage, content: command.forwardMessage, originalSpmtMessage: command.originalMessage } };
  }
  return { ...body, message: command.forwardMessage, content: command.forwardMessage, originalSpmtMessage: command.originalMessage };
}

export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-discord-trace-id') || crypto.randomUUID();
  const configuredBotToken = process.env.DISCORD_BOT_TOKEN;
  const suppliedBotToken = request.headers.get('x-discord-bot-token');

  if (!configuredBotToken) {
    trace(traceId, 'rejected', { reason: 'bot-token-not-configured' });
    return NextResponse.json({ error: 'Discord gateway ingress is not configured' }, { status: 503 });
  }
  if (!suppliedBotToken || suppliedBotToken !== configuredBotToken) {
    trace(traceId, 'rejected', { reason: 'invalid-bot-token' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: true, skipped: 'invalid-json' });

  const data = body?.root || body;
  const message = String(data?.message || data?.content || '');
  const channelId = String(data?.channelId || '');
  const guildId = String(data?.guildId || data?.serverId || '');
  const messageId = String(data?.messageId || '');
  const isBotAuthor = Boolean(data?.author?.bot || data?.user?.bot || data?.member?.user?.bot);
  const isDirectMessage = Boolean(data?.isDM || data?.isDirectMessage || data?.is_direct_message);
  const normalized = message.trim().toLowerCase();
  const spmtCommand = normalizePublicSpmtCommand(message, getDiscordClientId());
  const isSpmtCommand = Boolean(spmtCommand);
  const isBangCommand = normalized.startsWith('!');
  const isMtFixItCommand = parseMtFixItCommand(message) !== null;

  trace(traceId, 'ingress', {
    guildId: guildId || null,
    channelId: channelId || null,
    messageId: messageId || null,
    isDirectMessage,
    isBotAuthor,
    isSpmtCommand,
    isMtFixItCommand,
    messagePreview: message.slice(0, 120),
  });

  if (!channelId || !guildId || isDirectMessage || isBotAuthor) {
    return NextResponse.json({ success: true, skipped: 'not-public-human-message' });
  }

  const origin = request.nextUrl.origin.replace(/\/$/, '');
  const commonHeaders = { 'x-chat-origin': 'dsh-discord-gateway', 'x-discord-trace-id': traceId };

  // MtFixIt is a DSH-owned operational command. Route it exactly once to the
  // dedicated lifecycle endpoint and do not fan it out to StreamWeaver/ChatTag.
  if (isMtFixItCommand) {
    const delivery = await postJson(`${origin}/api/discord/mtfixit`, body, {
      ...commonHeaders,
      'x-discord-bot-token': configuredBotToken,
    }, 45_000);
    trace(traceId, 'delivery', { destination: 'dsh-mtfixit', ...delivery });
    return NextResponse.json({ success: delivery.ok, traceId, messageId, mtfixit: delivery }, { status: delivery.ok ? 200 : 502 });
  }

  const dshUrl = `${origin}/api/discord/chat`;
  const chatTagUrl = `${getChatTagApiBase().replace(/\/$/, '')}/api/discord/chat`;
  const streamweaverUrl = `${getStreamweaverUrl().replace(/\/$/, '')}/api/discord/chat`;
  const hearMeOutUrl = `${getHearMeOutUrl().replace(/\/$/, '')}/api/discord/chat`;

  const jobs: Array<Promise<any>> = [
    postJson(dshUrl, body, commonHeaders, 12_000).then((result) => ({ destination: 'dsh', ...result })),
    postJson(chatTagUrl, body, commonHeaders, 8_000).then((result) => ({ destination: 'chat-tag', ...result })),
  ];

  if (spmtCommand?.forwardMessage && !spmtCommand.controls) {
    const forwarded = withForwardedSpmtMessage(body, spmtCommand);
    jobs.push(postJson(streamweaverUrl, forwarded, { ...commonHeaders, 'x-chat-origin': 'dsh-discord-gateway-spmt' }, 45_000).then((result) => ({ destination: 'streamweaver-spmt', ...result })));
  }

  if (!isBangCommand && !isSpmtCommand) {
    jobs.push(postJson(streamweaverUrl, body, commonHeaders, 12_000).then((result) => ({ destination: 'streamweaver', ...result })));
    jobs.push(postJson(hearMeOutUrl, { ...body, dispatch: false }, commonHeaders, 8_000).then((result) => ({ destination: 'hearmeout-passive', ...result })));
  }

  const deliveries = await Promise.all(jobs);
  for (const delivery of deliveries) trace(traceId, 'delivery', delivery);

  return NextResponse.json({
    success: true,
    traceId,
    messageId,
    spmtCommand: spmtCommand ? { controls: spmtCommand.controls, forwarded: Boolean(spmtCommand.forwardMessage && !spmtCommand.controls) } : null,
    deliveries,
  });
}
