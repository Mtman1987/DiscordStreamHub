// Only pass server-owned records here, never roles or privilege flags from an
// incoming request. Discord commands do not have a browser SPMT cookie.
export function getDiscordMemberAccess(input: {
  userId: string;
  ownerDiscordId: string;
  server: Record<string, any>;
  member: Record<string, any>;
}) {
  const { userId, ownerDiscordId, server, member } = input;
  const list = (value: unknown): string[] => Array.isArray(value)
    ? value.map(item => String(item).trim().toLowerCase()).filter(Boolean) : [];
  const roles = [...list(member.roles), ...list(member.roleNames)];
  const isOwner = Boolean(userId && (userId === ownerDiscordId || userId === String(server.ownerId || '')));
  const isAdmin = isOwner || member.isAdmin === true || roles.some(role => list(server.adminRoles).includes(role));
  const isMod = isAdmin || member.isMod === true || roles.some(role => list(server.modRoles).includes(role));
  return { isOwner, isAdmin, isMod, matchedBy: isOwner ? 'discord-owner' : isAdmin ? 'discord-admin' : isMod ? 'discord-mod' : null };
}
