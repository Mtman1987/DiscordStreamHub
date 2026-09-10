type DiscordRole = { id: string; name: string; managed?: boolean };
type DiscordRequest = (path: string, init?: RequestInit) => Promise<any>;

// Add the title first. Only a confirmed grant permits removing clue roles.
// Every operation is idempotent, including recovery after a partial failure.
export async function applyVoidwalkerRole(input: {
  guildId: string; discordUserId: string; clueRoleId?: string;
  configuredTitleRoleId?: string; discord: DiscordRequest;
  rememberTitleRole: (roleId: string) => Promise<void>;
}) {
  const { guildId, discordUserId, discord } = input;
  if (!/^\d{15,22}$/.test(guildId) || !/^\d{15,22}$/.test(discordUserId)) throw new Error('A verified Discord guild and member ID are required');
  const member = await discord(`/guilds/${guildId}/members/${discordUserId}`);
  if (!Array.isArray(member?.roles)) throw new Error('Discord member roles are unavailable');
  const roles: DiscordRole[] = await discord(`/guilds/${guildId}/roles`);
  if (!Array.isArray(roles)) throw new Error('Discord guild roles are unavailable');
  let titleRole = roles.find((role) => role.id === input.configuredTitleRoleId)
    || roles.find((role) => role.name.toLowerCase() === 'voidwalker');
  if (titleRole?.managed) throw new Error('The Voidwalker role is managed by another integration');
  if (!titleRole) {
    titleRole = await discord(`/guilds/${guildId}/roles`, {
      method: 'POST', body: JSON.stringify({ name: 'Voidwalker', color: 0x8b5cf6, permissions: '0', mentionable: false, hoist: false }),
    });
  }
  if (!titleRole?.id) throw new Error('Discord did not return the Voidwalker role');
  await input.rememberTitleRole(titleRole.id);
  const held = new Set(member.roles.map(String));
  if (!held.has(titleRole.id)) {
    await discord(`/guilds/${guildId}/members/${discordUserId}/roles/${titleRole.id}`, { method: 'PUT' });
  }
  const clueRoleIds = roles.filter((role) => role.id !== titleRole.id && (
    role.id === input.clueRoleId || ['signal seeker', 'signal hunter'].includes(role.name.toLowerCase())
  )).map((role) => role.id).filter((id) => held.has(id));
  for (const roleId of clueRoleIds) {
    await discord(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, { method: 'DELETE' });
  }
  return { roleId: titleRole.id, removedRoleIds: clueRoleIds };
}
