import { db } from '@/lib/db';

const DISCORD_API = 'https://discord.com/api/v10';
const ROLE_NAME = 'Signal Seeker';

function botToken() {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) throw new Error('Discord bot token is unavailable');
  return token;
}

async function discord(path: string, init: RequestInit = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Discord ${init.method || 'GET'} ${path} failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export async function ensureSignalSeekerRole(guildId: string): Promise<string> {
  const configRef = db.collection('servers').doc(guildId).collection('config').doc('signal-seeker');
  const [configDoc, roles] = await Promise.all([
    configRef.get(),
    discord(`/guilds/${guildId}/roles`),
  ]);
  const configuredId = String(configDoc.data()?.roleId || '').trim();
  const list = Array.isArray(roles) ? roles : [];
  const existing = list.find((role: any) => String(role.id) === configuredId)
    || list.find((role: any) => String(role.name).toLowerCase() === ROLE_NAME.toLowerCase());
  if (existing?.id) {
    if (String(existing.id) !== configuredId) {
      await configRef.set({ roleId: String(existing.id), roleName: ROLE_NAME, updatedAt: new Date().toISOString() }, { merge: true });
    }
    return String(existing.id);
  }

  const created = await discord(`/guilds/${guildId}/roles`, {
    method: 'POST',
    body: JSON.stringify({ name: ROLE_NAME, color: 0x5865f2, mentionable: true, hoist: false }),
  });
  if (!created?.id) throw new Error('Discord did not return the new Signal Seeker role');
  await configRef.set({ roleId: String(created.id), roleName: ROLE_NAME, createdAt: new Date().toISOString() }, { merge: true });
  return String(created.id);
}

export async function setSignalSeekerMembership(input: {
  guildId: string;
  discordUserId: string;
  action: 'join' | 'leave' | 'toggle';
}): Promise<{ roleId: string; status: 'joined' | 'left' }> {
  const roleId = await ensureSignalSeekerRole(input.guildId);
  const member = await discord(`/guilds/${input.guildId}/members/${input.discordUserId}`);
  const hasRole = Array.isArray(member?.roles) && member.roles.map(String).includes(roleId);
  const shouldJoin = input.action === 'join' || (input.action === 'toggle' && !hasRole);
  await discord(`/guilds/${input.guildId}/members/${input.discordUserId}/roles/${roleId}`, {
    method: shouldJoin ? 'PUT' : 'DELETE',
  });
  return { roleId, status: shouldJoin ? 'joined' : 'left' };
}

export function signalSeekerComponents() {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Join the Egg Hunt', custom_id: 'signal_seekers:join', emoji: { name: '🥚' } },
      { type: 2, style: 2, label: 'Leave the Hunt', custom_id: 'signal_seekers:leave' },
    ],
  }];
}

export async function postSignalSeekerPanel(input: { guildId: string; channelId: string }) {
  await ensureSignalSeekerRole(input.guildId);
  return discord(`/channels/${input.channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      embeds: [{
        title: '📡 Signal Seekers',
        description: 'Join the hunt for all three hidden Space Mountain eggs. Signal Seekers are pinged when a new Signal appears. You can leave whenever you want.',
        color: 0x5865f2,
        footer: { text: 'No app login is required. Discord already knows who you are.' },
      }],
      components: signalSeekerComponents(),
      allowed_mentions: { parse: [] },
    }),
  });
}

export async function findDiscordMemberByTwitch(guildId: string, twitchUserId: string, twitchUsername: string) {
  const users = db.collection('servers').doc(guildId).collection('users');
  let snapshot = twitchUserId
    ? await users.where('twitchId', '==', twitchUserId).limit(1).get()
    : null;
  if (!snapshot || snapshot.empty) {
    snapshot = await users.where('twitchLogin', '==', twitchUsername.toLowerCase()).limit(1).get();
  }
  const doc = snapshot?.docs?.[0];
  if (!doc) return null;
  const data = doc.data() || {};
  return String(data.discordUserId || doc.id || '').trim() || null;
}
