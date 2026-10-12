// Public mirrors must never expand a restricted source channel's audience.
const VIEW_CHANNEL = BigInt('1024');
export function isPublicMirrorSource(guild: any, channel: any): boolean {
  try {
    if (!guild?.id || channel?.guild_id !== guild.id || ![0, 2, 5, 13].includes(Number(channel.type))) return false;
    const everyone = guild.roles?.find((role: any) => role.id === guild.id);
    if (!everyone || !Array.isArray(channel.permission_overwrites)) return false;
    let permissions = BigInt(everyone.permissions);
    const overwrite = channel.permission_overwrites.find((item: any) => item.id === guild.id && Number(item.type) === 0);
    if (overwrite) permissions = (permissions & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow);
    if (!(permissions & VIEW_CHANNEL)) return false;
    // Even a member-specific or role-specific viewing restriction makes this
    // unsuitable for a public replica. Administrator bot access is irrelevant.
    return !channel.permission_overwrites.some((item: any) => item.id !== guild.id && (BigInt(item.deny) & VIEW_CHANNEL) !== BigInt(0));
  } catch { return false; }
}
