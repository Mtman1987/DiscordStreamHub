import { NextRequest, NextResponse } from 'next/server';
import { getChatTagApiBase, getDiscordClientId, getHardcodedGuildId, getHearMeOutUrl, getStreamweaverUrl } from '@/lib/runtime-config';
import { getChatTagServiceSecret } from '@/lib/runtime-secrets';
import { normalizePublicSpmtCommand, type PublicSpmtCommand } from '@/lib/discord-spmt-command';
import { parseMtFixItCommand } from '@/lib/mtfixit-contract';
import { postCommandSignalDrop, postSignalSeekerPanel } from '@/lib/signal-seeker-service';
import { recordRelayChatActivity } from '@/lib/relay-presence';
import { db } from '@/lib/db';
import { sendDiscordMessage } from '@/lib/discord-bot-service';

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

async function handleSpmtOptOut(input: {
  guildId: string;
  channelId: string;
  userId: string;
  displayName: string;
}) {
  const userRef = db.collection('servers').doc(input.guildId).collection('users').doc(input.userId);
  let userSnap = await userRef.get();
  let user = userSnap.exists ? (userSnap.data() || {}) : null;

  if (!user) {
    const users = await db.collection('servers').doc(input.guildId).collection('users').get();
    const match = users.docs.find((doc: any) => {
      const data = doc.data() || {};
      return String(data.discordUserId || '').trim() === input.userId;
    });
    if (match) {
      userSnap = match;
      user = match.data() || {};
    }
  }

  const twitchLogin = String(user?.twitchLogin || user?.twitchUsername || '').trim().toLowerCase().replace(/^#/, '');
  if (!twitchLogin) {
    await sendDiscordMessage(input.channelId, {
      content: `@${input.displayName} I could not find a linked Twitch channel to opt out. Link the Twitch account first, or ask an SPMT admin to remove it manually.`,
    }).catch(() => null);
    return { ok: false, reason: 'no-linked-twitch' };
  }

  const now = new Date().toISOString();
  await db.collection('servers').doc(input.guildId).collection('twitchChatBlacklist').doc(twitchLogin).set({
    channel: twitchLogin,
    reason: 'user-opt-out',
    permanent: true,
    noContact: true,
    userNotificationState: 'user-opted-out',
    firstDetectedAt: now,
    lastDetectedAt: now,
    quarantinedAt: now,
    completedAt: now,
  }, { merge: true });

  const chatTagBase = getChatTagApiBase().replace(/\/$/, '');
  const chatTagSecret = getChatTagServiceSecret();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (chatTagSecret) headers['x-bot-secret'] = chatTagSecret;
  const blacklist = await postJson(
    `${chatTagBase}/api/bot/blacklist`,
    { channel: twitchLogin, source: 'user-opt-out' },
    headers,
    8_000,
  );

  if (!blacklist.ok) {
    return { ok: false, reason: 'chat-tag-blacklist-failed', twitchLogin, blacklist };
  }

  await sendDiscordMessage(input.channelId, {
    content: `@${input.displayName} opt-out confirmed for Twitch channel **${twitchLogin}**. SPMT bots and automated join/contact attempts will stay blocked unless you explicitly opt back in later.`,
  }).catch(() => null);

  return { ok: true, twitchLogin };
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
  const effectiveGuildId = guildId || getHardcodedGuildId();
  const messageId = String(data?.messageId || '');
  const userId = String(data?.userId || data?.author?.id || '').trim();
  const isBotAuthor = Boolean(data?.author?.bot || data?.user?.bot || data?.member?.user?.bot);
  const isDirectMessage = Boolean(data?.isDM || data?.isDirectMessage || data?.is_direct_message);
  const normalized = message.trim().toLowerCase();
  const spmtCommand = normalizePublicSpmtCommand(message, getDiscordClientId());
  const isSpmtCommand = Boolean(spmtCommand);
  const isBangCommand = normalized.startsWith('!');
  const isStreamweaverSignalCommand = /^!signal(?:bot)?(?:\s|$)/i.test(message.trim());
  const isSignalSeekerCommand = /^!signal\s*$/i.test(message.trim());
  const isMtFixItCommand = parseMtFixItCommand(message) !== null;
  const isSpmtOptOut = /^@?spmt\s+opt(?:-|\s*)out\s*$/i.test(message.trim());

  trace(traceId, 'ingress', {
    guildId: guildId || null,
    channelId: channelId || null,
    messageId: messageId || null,
    isDirectMessage,
    isBotAuthor,
    isSpmtCommand,
    isStreamweaverSignalCommand,
    isMtFixItCommand,
    messagePreview: message.slice(0, 120),
  });

  if (!channelId || isBotAuthor || (!effectiveGuildId && isSpmtOptOut)) {
    return NextResponse.json({ success: true, skipped: 'missing-command-context' });
  }
  if ((!guildId || isDirectMessage) && !isSpmtOptOut) {
    return NextResponse.json({ success: true, skipped: 'not-public-human-message' });
  }

  if (userId) {
    recordRelayChatActivity({
      userId,
      guildId: effectiveGuildId,
      username: data?.author?.username || data?.userName,
      displayName: data?.displayName || data?.userName,
      channelId,
      channelName: data?.channelName,
      voiceChannelId: data?.voiceChannelId,
      voiceChannelName: data?.voiceChannelName,
      observedAt: new Date().toISOString(),
    });
  }

  if (isSpmtOptOut) {
    if (!userId) return NextResponse.json({ error: 'Missing Discord user identity' }, { status: 400 });
    const result = await handleSpmtOptOut({
      guildId: effectiveGuildId,
      channelId,
      userId,
      displayName: String(data?.displayName || data?.userName || data?.author?.username || 'user'),
    });
    trace(traceId, 'delivery', { destination: 'spmt-opt-out', ...result });
    return NextResponse.json({ success: result.ok, traceId, messageId, optOut: result }, { status: result.ok ? 200 : 502 });
  }

  if (isSignalSeekerCommand) {
    try {
      const panel = await postSignalSeekerPanel({ guildId, channelId });
      const signal = await postCommandSignalDrop({ guildId, channelId, channelName: String(data?.channelName || channelId) });
      trace(traceId, 'delivery', {
        destination: 'dsh-signal-command',
        ok: true,
        panelMessageId: panel?.id || null,
        signalMessageId: signal.messageId,
        dropId: signal.dropId,
      });
      return NextResponse.json({
        success: true,
        traceId,
        messageId,
        signalSeekers: true,
        signalDrop: { dropId: signal.dropId, messageId: signal.messageId, expiresAt: signal.expiresAt },
      });
    } catch (error) {
      trace(traceId, 'delivery', { destination: 'dsh-signal-seekers', ok: false, error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Unable to open the Signal Seeker journey' }, { status: 502 });
    }
  }

  const origin = request.nextUrl.origin.replace(/\/$/, '');
  const commonHeaders = { 'x-chat-origin': 'dsh-discord-gateway', 'x-discord-trace-id': traceId };

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
  const chatTagServiceSecret = getChatTagServiceSecret();
  const chatTagHeaders = chatTagServiceSecret
    ? { ...commonHeaders, 'x-bot-secret': chatTagServiceSecret }
    : commonHeaders;

  const jobs: Array<Promise<any>> = [
    postJson(dshUrl, body, commonHeaders, 12_000).then((result) => ({ destination: 'dsh', ...result })),
    postJson(chatTagUrl, body, chatTagHeaders, 8_000).then((result) => ({ destination: 'chat-tag', ...result })),
  ];

  if (spmtCommand?.forwardMessage && !spmtCommand.controls) {
    const forwarded = withForwardedSpmtMessage(body, spmtCommand);
    jobs.push(postJson(streamweaverUrl, forwarded, { ...commonHeaders, 'x-chat-origin': 'dsh-discord-gateway-spmt' }, 45_000).then((result) => ({ destination: 'streamweaver-spmt', ...result })));
  }

  if (isStreamweaverSignalCommand || (!isBangCommand && !isSpmtCommand)) {
    jobs.push(postJson(streamweaverUrl, body, commonHeaders, 12_000).then((result) => ({ destination: 'streamweaver', ...result })));
  }

  if (!isBangCommand && !isSpmtCommand) {
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
