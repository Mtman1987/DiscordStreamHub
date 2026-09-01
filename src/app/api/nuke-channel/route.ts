import { NextRequest, NextResponse } from 'next/server';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_EPOCH = 1420070400000n;
const BULK_DELETE_MAX_AGE_MS = 13.8 * 24 * 60 * 60 * 1000;

type NukeMode = 'bot' | 'all' | 'until';

type DiscordMessage = {
  id: string;
  author?: { id?: string; bot?: boolean };
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{16,22}$/.test(value.trim());
}

function snowflakeTimestamp(id: string): number {
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
  } catch {
    return 0;
  }
}

function isBulkDeleteEligible(id: string): boolean {
  const createdAt = snowflakeTimestamp(id);
  return createdAt > 0 && Date.now() - createdAt < BULK_DELETE_MAX_AGE_MS;
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function discordRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      cache: 'no-store',
    });

    if (response.status !== 429 || attempt === 5) return response;

    const body = await response.clone().json().catch(() => null) as { retry_after?: number } | null;
    const headerSeconds = Number(response.headers.get('retry-after') || 0);
    const retrySeconds = Number(body?.retry_after || headerSeconds || 1);
    await sleep(Math.min(10_000, Math.max(250, retrySeconds * 1000 + 100)));
  }

  throw new Error('Discord request retry loop exhausted');
}

async function requireDshAdmin(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) return null;
  const resolved = await resolveSpmtSession(token).catch(() => null);
  return resolved?.session?.isAdmin ? resolved.session : null;
}

async function deleteOne(channelId: string, messageId: string, token: string) {
  const response = await discordRequest(`/channels/${channelId}/messages/${messageId}`, token, { method: 'DELETE' });
  if (response.ok || response.status === 404) return true;
  const error = await response.text().catch(() => response.statusText);
  throw new Error(`Discord rejected message ${messageId}: ${response.status} ${error.slice(0, 240)}`);
}

async function deleteSelected(channelId: string, ids: string[], token: string) {
  let deleted = 0;
  let failed = 0;
  const logs: string[] = [];
  const recent = ids.filter(isBulkDeleteEligible);
  const old = ids.filter(id => !isBulkDeleteEligible(id));

  for (let offset = 0; offset < recent.length; offset += 100) {
    const chunk = recent.slice(offset, offset + 100);
    if (chunk.length === 1) {
      try {
        await deleteOne(channelId, chunk[0], token);
        deleted += 1;
      } catch (error) {
        failed += 1;
        logs.push(error instanceof Error ? error.message : String(error));
      }
      continue;
    }

    if (chunk.length > 1) {
      const response = await discordRequest(`/channels/${channelId}/messages/bulk-delete`, token, {
        method: 'POST',
        body: JSON.stringify({ messages: chunk }),
      });
      if (response.ok) {
        deleted += chunk.length;
        continue;
      }

      const bulkError = await response.text().catch(() => response.statusText);
      logs.push(`Bulk delete returned ${response.status}; retrying individually. ${bulkError.slice(0, 180)}`);
      for (const id of chunk) {
        try {
          await deleteOne(channelId, id, token);
          deleted += 1;
        } catch (error) {
          failed += 1;
          logs.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
  }

  for (const id of old) {
    try {
      await deleteOne(channelId, id, token);
      deleted += 1;
    } catch (error) {
      failed += 1;
      logs.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { deleted, failed, logs };
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireDshAdmin(request);
    if (!admin) return jsonError('DSH admin session required for channel deletion', 403);

    const body = await request.json().catch(() => null) as {
      channelId?: string;
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
    const channel = await channelResponse.json() as { guild_id?: string; name?: string };
    const guildId = String(channel.guild_id || '');
    if (!guildId || guildId !== String(getHardcodedGuildId())) {
      return jsonError('That channel is not part of the configured Space Mountain Discord server', 403);
    }

    if (mode === 'until') {
      const targetResponse = await discordRequest(`/channels/${channelId}/messages/${untilMessageId}`, botToken);
      if (!targetResponse.ok) return jsonError('The stop message ID was not found in this channel', 404);
    }

    const meResponse = await discordRequest('/users/@me', botToken);
    if (!meResponse.ok) return jsonError('Discord bot identity could not be resolved', 502);
    const botIdentity = await meResponse.json() as { id?: string };
    const botId = String(botIdentity.id || '');
    if (!botId) return jsonError('Discord bot identity did not include an ID', 502);

    let before = '';
    let deleted = 0;
    let failed = 0;
    let pages = 0;
    let reachedTarget = mode !== 'until';
    const log: string[] = [`Cleaning #${channel.name || channelId} in ${mode} mode...`];

    while (pages < 10_000) {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const response = await discordRequest(`/channels/${channelId}/messages?${query.toString()}`, botToken);
      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`Could not read channel history: ${response.status} ${detail.slice(0, 240)}`);
      }

      const messages = await response.json() as DiscordMessage[];
      if (!Array.isArray(messages) || messages.length === 0) break;
      pages += 1;
      before = messages[messages.length - 1].id;

      let candidates = messages;
      if (mode === 'until') {
        const stopIndex = messages.findIndex(message => message.id === untilMessageId);
        if (stopIndex >= 0) {
          candidates = messages.slice(0, stopIndex);
          reachedTarget = true;
        }
      }

      const selected = mode === 'bot'
        ? candidates.filter(message => String(message.author?.id || '') === botId)
        : candidates;

      if (selected.length > 0) {
        const result = await deleteSelected(channelId, selected.map(message => message.id), botToken);
        deleted += result.deleted;
        failed += result.failed;
        log.push(`Page ${pages}: deleted ${result.deleted}${result.failed ? `, failed ${result.failed}` : ''}.`);
        log.push(...result.logs.slice(0, 8));
      }

      if (mode === 'until' && reachedTarget) break;
      if (messages.length < 100) break;
    }

    if (mode === 'until' && !reachedTarget) {
      log.push('Warning: the stop message was validated before cleanup but was not encountered during pagination.');
    }

    log.push(`Finished: ${deleted} deleted${failed ? `, ${failed} failed` : ''}.`);
    return NextResponse.json({ success: failed === 0, deleted, failed, log, reachedTarget });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API /nuke-channel] failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
