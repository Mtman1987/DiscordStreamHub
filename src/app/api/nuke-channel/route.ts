import { NextRequest, NextResponse } from 'next/server';
import { requireGuildManagement, channelPermissions } from '@/lib/discord-guild-access';
import { sameOrigin, ServerConnectionError } from '@/lib/discord-server-connections';

import { enqueueCleanup, cleanupJob, cleanupJobs } from '@/lib/discord-channel-cleanup';
import { serverAccount } from '@/lib/discord-server-connections';
export const dynamic = 'force-dynamic';
function jsonError(error: string, status: number) { return NextResponse.json({ success: false, error }, { status }); }
function isSnowflake(value: unknown): value is string { return typeof value === 'string' && /^\d{16,22}$/.test(value.trim()); }
const discordRequest = (path: string, token: string, options?: RequestInit) => fetch('https://discord.com/api/v10' + path, {
  ...options, headers: { Authorization: 'Bot ' + token, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
  cache: 'no-store', signal: AbortSignal.timeout(10_000),
});
type NukeMode = 'bot' | 'all' | 'until';

export async function GET(request: NextRequest) {
  try {
    const session = await serverAccount(request);
    const id = request.nextUrl.searchParams.get('jobId');
    const guildId = request.nextUrl.searchParams.get('guildId');
    const job = id ? cleanupJob(id) : cleanupJobs().filter(job => job.ownerAccountId === session.spmtUserId && job.guildId === guildId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!job) return NextResponse.json({ success: true, job: null }, { headers: { 'Cache-Control': 'no-store' } });
    if (job.ownerAccountId !== session.spmtUserId) return jsonError('That cleanup belongs to a different account.', 403);
    return NextResponse.json({ success: job.status !== 'failed', job, log: job.log, deleted: job.deleted, failed: job.failed, error: job.error }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return jsonError(error instanceof Error ? error.message : 'Unable to load cleanup progress', error instanceof ServerConnectionError ? error.status : 500); }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);

    const body = await request.json().catch(() => null) as {
      channelId?: string;
      guildId?: string;
      mode?: NukeMode;
      untilMessageId?: string;
    } | null;

    const channelId = String(body?.channelId || '').trim();
    const mode = body?.mode;
    const untilMessageId = String(body?.untilMessageId || '').trim();

    if (!isSnowflake(channelId)) return jsonError('A valid Discord channel ID is required', 400);
    if (!['bot', 'all', 'until'].includes(String(mode))) return jsonError('Invalid nuke mode', 400);
    if (mode === 'until' && !isSnowflake(untilMessageId)) return jsonError('A valid stop message ID is required', 400);

    const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
    if (!botToken) return jsonError('Discord bot token is not configured', 503);

    const channelResponse = await discordRequest(`/channels/${channelId}`, botToken);
    if (!channelResponse.ok) {
      const detail = await channelResponse.text().catch(() => channelResponse.statusText);
      return jsonError(`Discord could not open that channel (${channelResponse.status}): ${detail.slice(0, 200)}`, channelResponse.status);
    }
    const channel = await channelResponse.json() as { guild_id?: string; name?: string; type?: number; parent_id?: string; permission_overwrites?: any[] };
    const guildId = String(channel.guild_id || '');
    if (!guildId || guildId !== String(body?.guildId || '')) return jsonError('Choose a channel in the selected server.', 403);
    if (![0, 2, 5, 10, 11, 12, 13].includes(Number(channel.type))) return jsonError('Choose a message channel or thread, not a category/forum parent.', 400);
    const { session, guild, member } = await requireGuildManagement(request, guildId);
    let permissionChannel: any = channel;
    if ([10, 11, 12].includes(Number(channel.type)) && channel.parent_id) {
      const parentResponse = await discordRequest('/channels/' + channel.parent_id, botToken);
      if (!parentResponse.ok) return jsonError('Cannot verify parent channel permissions.', 403);
      permissionChannel = await parentResponse.json();
    }
    const permissions = channelPermissions(guild, member, permissionChannel);
    if ((permissions & BigInt('8')) === BigInt(0) && (permissions & BigInt('8192')) === BigInt(0)) return jsonError('Manage Messages permission in this channel is required.', 403);

    if (mode === 'until') {
      const targetResponse = await discordRequest(`/channels/${channelId}/messages/${untilMessageId}`, botToken);
      if (!targetResponse.ok) return jsonError('The stop message ID was not found in this channel', 404);
    }

    const meResponse = await discordRequest('/users/@me', botToken);
    if (!meResponse.ok) return jsonError('Discord bot identity could not be resolved', 502);
    const botIdentity = await meResponse.json() as { id?: string };
    const botId = String(botIdentity.id || '');
    if (!botId) return jsonError('Discord bot identity did not include an ID', 502);

    // The worker owns deletion; this HTTP request only validates and schedules it.
    const job = enqueueCleanup({
      ownerAccountId: session.spmtUserId!, discordUserId: session.discordUserId!,
      guildId, channelId, channelName: channel.name || channelId,
      mode: mode!, untilMessageId: mode === 'until' ? untilMessageId : '', botId,
    });
    return NextResponse.json({ success: true, accepted: true, jobId: job.id, job, log: job.log }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API /nuke-channel] failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: error instanceof ServerConnectionError ? error.status : 500 });
  }
}
