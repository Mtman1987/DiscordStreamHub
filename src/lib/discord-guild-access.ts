import { NextRequest } from 'next/server';
import { serverAccount, discordApi, ServerConnectionError } from './discord-server-connections';
import { guildAccess } from './discord-server-permissions';

export function memberPermissions(guild: any, member: any): bigint {
  if (guild.owner_id === member.user?.id) return BigInt('8');
  const ids = new Set([guild.id, ...(member.roles || [])]);
  return (guild.roles || []).reduce((bits: bigint, role: any) => ids.has(role.id) ? bits | BigInt(role.permissions || '0') : bits, BigInt(0));
}
export function channelPermissions(guild: any, member: any, channel: any): bigint {
  let bits = memberPermissions(guild, member);
  if ((bits & BigInt('8')) !== BigInt(0)) return bits;
  const overwrites = channel.permission_overwrites || [];
  const everyone = overwrites.find((o: any) => o.id === guild.id);
  if (everyone) bits = (bits & ~BigInt(everyone.deny || '0')) | BigInt(everyone.allow || '0');
  let deny = BigInt(0), allow = BigInt(0);
  for (const overwrite of overwrites) {
    if (Number(overwrite.type) === 0 && overwrite.id !== guild.id && member.roles?.includes(overwrite.id)) {
      deny |= BigInt(overwrite.deny || '0'); allow |= BigInt(overwrite.allow || '0');
    }
  }
  bits = (bits & ~deny) | allow;
  const personal = overwrites.find((o: any) => Number(o.type) === 1 && o.id === member.user?.id);
  return personal ? (bits & ~BigInt(personal.deny || '0')) | BigInt(personal.allow || '0') : bits;
}
export async function requireGuildManagement(request: NextRequest, guildId: string) {
  const session = await serverAccount(request);
  if (!session.discordUserId) throw new ServerConnectionError('Link your Discord account first.', 409);
  const auth = 'Bot ' + (process.env.DISCORD_BOT_TOKEN || '');
  const [guild, member] = await Promise.all([
    discordApi('/guilds/' + guildId, auth),
    discordApi('/guilds/' + guildId + '/members/' + session.discordUserId, auth),
  ]);
  if (!guildAccess({ owner: guild.owner_id === session.discordUserId, permissions: memberPermissions(guild, member).toString() }).canManage) {
    throw new ServerConnectionError('You do not have management access to this server.', 403);
  }
  return { session, guild, member };
}
