import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { mtFixItPublicReply, parseMtFixItCommand } from './lib/mtfixit-contract';
import { submitMtFixIt } from './lib/mtfixit-service';

async function sendDiscordReply(channelId: string, content: string) {
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!botToken || !channelId) return null;
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.error(`[DSH] Discord acknowledgement failed status=${response.status} body=${(await response.text()).slice(0, 300)}`);
    return null;
  }
  return response.json().catch(() => null);
}

async function sendRequesterDm(userId: string, content: string) {
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!botToken || !userId) throw new Error('Discord bot token or user identity is unavailable.');
  const opened = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: userId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!opened.ok) throw new Error(`Could not open requester DM: ${opened.status}`);
  const dm = await opened.json() as { id?: string };
  if (!dm.id) throw new Error('Discord did not return a DM channel.');
  const sent = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!sent.ok) throw new Error(`Discord rejected requester DM: ${sent.status}`);
  return sent.json().catch(() => null);
}

async function handleDiscordDmMe(request: NextRequest) {
  if (request.method !== 'POST' || request.nextUrl.pathname !== '/api/discord/chat') return null;
  const body = await request.clone().json().catch(() => null) as any;
  if (!body) return null;
  const data = body.root || body;
  const commandText = String(data.message || data.content || '').trim();
  if (!/^!dm\s+me$/i.test(commandText)) return null;

  const channelId = String(data.channelId || '').trim();
  const reporterId = String(data.userId || data.author?.id || '').trim();
  if (!reporterId) return NextResponse.json({ success: false, commandHandled: 'dm-me', error: 'Missing Discord user identity' }, { status: 400 });

  try {
    const sent = await sendRequesterDm(reporterId, 'DSH private messages are enabled. Athena and future owner-approved workflows can reply to you here.');
    await sendDiscordReply(channelId, 'I sent you a DM.');
    return NextResponse.json({ success: true, commandHandled: 'dm-me', sent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendDiscordReply(channelId, 'I could not DM you. Check that server DMs are enabled and try again.');
    return NextResponse.json({ success: false, commandHandled: 'dm-me', error: message }, { status: 502 });
  }
}

async function handleDiscordMtFixIt(request: NextRequest) {
  if (request.method !== 'POST' || request.nextUrl.pathname !== '/api/discord/chat') return null;

  const body = await request.clone().json().catch(() => null) as any;
  if (!body) return null;
  const data = body.root || body;
  const commandText = String(data.message || data.content || '');
  const description = parseMtFixItCommand(commandText);
  if (description === null) return null;

  const channelId = String(data.channelId || '').trim();
  const reporterId = String(data.userId || data.author?.id || '').trim();
  const reporter = String(data.userName || data.displayName || data.username || data.author?.username || 'Discord user').trim();
  const guildId = String(data.guildId || data.serverId || '').trim();
  const messageId = String(data.messageId || data.message_id || '').trim();

  if (!description) {
    await sendDiscordReply(channelId, mtFixItPublicReply('usage'));
    return NextResponse.json({ success: true, commandHandled: 'mtfixit', accepted: false, reason: 'missing-description' });
  }
  if (!channelId || !reporterId) {
    console.error('[MtFixIt] Discord command missing channel or reporter identity');
    return NextResponse.json({ success: false, commandHandled: 'mtfixit', error: 'Missing Discord context' }, { status: 400 });
  }

  try {
    await submitMtFixIt({
      source: 'discord',
      reporter,
      reporterId,
      description,
      tenantId: guildId || undefined,
      channelId,
      channelName: String(data.channelName || data.channel?.name || '').trim() || undefined,
      guildId: guildId || undefined,
      messageId: messageId || undefined,
    });
    const sent = await sendDiscordReply(channelId, mtFixItPublicReply('accepted'));
    return NextResponse.json({ success: true, commandHandled: 'mtfixit', accepted: true, sent });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[MtFixIt] Discord submission failed:', error);
    await sendDiscordReply(channelId, mtFixItPublicReply('failed'));
    return NextResponse.json({ success: false, commandHandled: 'mtfixit', error: errorMessage }, { status: 502 });
  }
}

export async function proxy(request: NextRequest) {
  const dmMeResponse = await handleDiscordDmMe(request);
  if (dmMeResponse) return dmMeResponse;

  const mtFixItResponse = await handleDiscordMtFixIt(request);
  if (mtFixItResponse) return mtFixItResponse;

  const response = NextResponse.next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, rsc, next-router-state-tree, next-url');
  response.headers.set('Access-Control-Max-Age', '86400');

  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 200, headers: response.headers });
  return response;
}

export const config = {
  matcher: ['/api/((?!clips/upload).*)'],
};
