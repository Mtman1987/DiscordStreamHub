import { NextRequest, NextResponse } from 'next/server';
import { getHardcodedGuildId } from '@/lib/runtime-config';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';
import { grandfatherDiscordIdentity } from '@/lib/spmt-client';

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const allowedSecrets = getServiceToServiceSecrets();
  if (allowedSecrets.length === 0) return false;
  if (hasAuthorizedBearerToken(request.headers.get('authorization'), allowedSecrets)) return true;
  const supplied = String(request.headers.get('x-bot-secret') || '').trim();
  return Boolean(supplied && allowedSecrets.includes(supplied));
}

async function fetchMembers(guildId: string, after: string, limit: number) {
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN is not configured');
  const params = new URLSearchParams({ limit: String(limit) });
  if (after) params.set('after', after);
  const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members?${params.toString()}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Discord member list failed (${response.status})`);
  return await response.json() as any[];
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const guildId = String(body.guildId || getHardcodedGuildId()).trim();
  const after = String(body.after || '').trim();
  const limit = Math.max(1, Math.min(200, Number(body.limit) || 100));
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: 'Invalid guildId' }, { status: 400 });
  if (after && !/^\d{17,20}$/.test(after)) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });

  try {
    const members = await fetchMembers(guildId, after, limit);
    const users = members.filter(member => member?.user?.id && !member.user.bot);
    let succeeded = 0;
    let created = 0;
    let failed = 0;

    for (let offset = 0; offset < users.length; offset += 10) {
      const results = await Promise.all(users.slice(offset, offset + 10).map(async member => {
        const result = await grandfatherDiscordIdentity({
          discordId: String(member.user.id),
          discordUsername: String(member.user.username || member.user.id),
          displayName: String(member.nick || member.user.global_name || member.user.username || member.user.id),
          issueSession: false,
        });
        return result;
      }));
      for (const result of results) {
        if (result?.user) {
          succeeded += 1;
          if (result.created) created += 1;
        } else {
          failed += 1;
        }
      }
    }

    const nextAfter = members.length > 0 ? String(members[members.length - 1]?.user?.id || '') : '';
    return NextResponse.json({
      guildId,
      scanned: members.length,
      eligible: users.length,
      succeeded,
      created,
      failed,
      nextAfter: members.length === limit ? nextAfter : null,
      complete: members.length < limit,
    });
  } catch (error) {
    console.error('[admin/spmt-discord-backfill] Failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Backfill failed' }, { status: 502 });
  }
}
