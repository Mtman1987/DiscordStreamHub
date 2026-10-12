import { guildAccess } from './discord-server-permissions';

type DiscordFetch = typeof fetch;

// Discover only servers that this bot can see, using a verified linked user ID.
// A username is never accepted as authorization to another person's server.
export async function botAccountGuilds(discordUserId: string, botToken: string, fetcher: DiscordFetch = fetch) {
  if (!/^\d{17,20}$/.test(discordUserId)) throw new Error('Link your Discord account in SPMT settings to identify your servers.');
  if (!botToken) throw new Error('SPMT bot is not configured.');
  const get = async (path: string, optionalMember = false) => {
    const response = await fetcher('https://discord.com/api/v10' + path, {
      headers: { Authorization: 'Bot ' + botToken }, cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (optionalMember && [403, 404].includes(response.status)) return null;
    if (!response.ok) throw new Error('Discord server lookup failed (' + response.status + '). Try refreshing servers.');
    return response.json();
  };
  const installed: any[] = [];
  let after = '';
  for (let page = 0; page < 20; page++) {
    const batch = await get('/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''));
    installed.push(...batch);
    if (batch.length < 200) break;
    const next = String(batch[batch.length - 1].id);
    if (next === after) break;
    after = next;
  }
  const guilds: any[] = [];
  for (let start = 0; start < installed.length; start += 4) {
    const group = await Promise.all(installed.slice(start, start + 4).map(async summary => {
      const member = await get('/guilds/' + summary.id + '/members/' + discordUserId, true);
      if (!member) return null;
      const guild = await get('/guilds/' + summary.id);
      const owned = guild.owner_id === discordUserId;
      const roles = new Set([guild.id, ...(member.roles || [])]);
      let permissions = BigInt(0);
      for (const role of guild.roles || []) if (roles.has(role.id)) permissions |= BigInt(role.permissions || '0');
      const value = { ...summary, name: guild.name || summary.name, owner: owned, permissions: permissions.toString() };
      return guildAccess(value).canManage ? value : null;
    }));
    guilds.push(...group.filter(Boolean));
  }
  return { discordUserId, guilds };
}
