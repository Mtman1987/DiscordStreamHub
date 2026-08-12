import { NextRequest, NextResponse } from 'next/server';
import { getChatTagApiBase, getHearMeOutUrl, getStreamweaverUrl } from '@/lib/runtime-config';
import { getSpmtServiceToken } from '@/lib/spmt-service-token';

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
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  const isSpmtCommand = normalized.startsWith('spmt ') || normalized.startsWith('@spmt ');
  const isBangCommand = normalized.startsWith('!');

  trace(traceId, 'ingress', {
    guildId: guildId || null,
    channelId: channelId || null,
    messageId: messageId || null,
    isDirectMessage,
    isBotAuthor,
    messagePreview: message.slice(0, 120),
  });

  if (!channelId || !guildId || isDirectMessage || isBotAuthor) {
    return NextResponse.json({ success: true, skipped: 'not-public-human-message' });
  }

  const dshUrl = `${request.nextUrl.origin.replace(/\/$/, '')}/api/discord/chat`;
  const chatTagUrl = `${getChatTagApiBase().replace(/\/$/, '')}/api/discord/chat`;
  const streamweaverUrl = `${getStreamweaverUrl().replace(/\/$/, '')}/api/discord/chat`;
  const hearMeOutUrl = `${getHearMeOutUrl().replace(/\/$/, '')}/api/discord/chat`;

  const commonHeaders = {
    'x-chat-origin': 'dsh-discord-gateway',
    'x-discord-trace-id': traceId,
  };

  const jobs: Array<Promise<any>> = [
    postJson(dshUrl, body, commonHeaders, 12_000).then((result) => ({ destination: 'dsh', ...result })),
    getSpmtServiceToken(['discord:control'])
      .then((token) => postJson(chatTagUrl, body, { ...commonHeaders, authorization: `Bearer ${token}` }, 8_000))
      .then((result) => ({ destination: 'chat-tag', ...result }))
      .catch((error) => ({ destination: 'chat-tag', ok: false, status: 503, durationMs: 0, error: error instanceof Error ? error.message : String(error) })),
  ];

  // DSH already routes active bang commands to StreamWeaver/HearMeOut. Avoid
  // sending those twice. Regular public chat goes to both passive consumers so
  // Athena/context features keep receiving the same messages Kite carried.
  if (!isBangCommand && !isSpmtCommand) {
    jobs.push(
      postJson(streamweaverUrl, body, commonHeaders, 12_000)
        .then((result) => ({ destination: 'streamweaver', ...result })),
    );
    jobs.push(
      postJson(hearMeOutUrl, { ...body, dispatch: false }, commonHeaders, 8_000)
        .then((result) => ({ destination: 'hearmeout-passive', ...result })),
    );
  }

  const deliveries = await Promise.all(jobs);
  for (const delivery of deliveries) {
    trace(traceId, 'delivery', delivery);
  }

  return NextResponse.json({
    success: true,
    traceId,
    messageId,
    deliveries,
  });
}
