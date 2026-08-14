import { getHardcodedGuildId } from '@/lib/runtime-config';

export const DSH_SPMT_COOKIE = 'dsh_spmt_session';
export const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type DshSpmtSession = {
  spmtUserId?: string;
  spmtUsername?: string;
  discordUserId?: string;
  discordUsername?: string;
  discordDisplayName?: string;
  discordAvatar?: string;
  twitchUsername?: string;
  discordServerId: string;
  dshAuthMode: 'spmt';
  isLoggedIn: true;
  isAdmin: boolean;
  role: string;
};

function readLinkedAccount(user: any, provider: string) {
  const accounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : [];
  return accounts.find((account: any) => account?.provider === provider) || user?.[provider] || {};
}

function text(...values: unknown[]): string {
  return String(values.find((value) => value !== undefined && value !== null && String(value).trim()) || '').trim();
}

export function spmtIdentityIsAdmin(user: any): boolean {
  if (user?.isAdmin === true || user?.is_admin === true || user?.is_admin === 1) return true;
  const role = text(user?.role).toLowerCase();
  if (role === 'admin' || role === 'owner') return true;
  const roles = Array.isArray(user?.roles) ? user.roles.map((value: unknown) => text(value).toLowerCase()) : [];
  return roles.includes('admin') || roles.includes('owner');
}

export function buildDshSpmtSession(user: any): DshSpmtSession {
  if (!user?.id) throw new Error('SPMT identity did not include a user id');
  const discord = readLinkedAccount(user, 'discord');
  const twitch = readLinkedAccount(user, 'twitch');
  const role = text(user?.role, spmtIdentityIsAdmin(user) ? 'admin' : 'member').toLowerCase();

  return {
    spmtUserId: text(user.id),
    spmtUsername: text(user.username),
    discordUserId: text(user.discordUserId, user.discord_user_id, user.discordId, user.discord_id, discord.id, discord.userId),
    discordUsername: text(user.discordUsername, user.discord_username, discord.username, user.username, user.displayName),
    discordDisplayName: text(user.discordDisplayName, user.discord_display_name, discord.displayName, discord.global_name, user.displayName, user.username),
    discordAvatar: text(user.avatarUrl, user.avatar_url, discord.avatarUrl, discord.avatar_url, twitch.avatarUrl, twitch.avatar_url),
    twitchUsername: text(user.twitchUsername, user.twitch_login, twitch.username, twitch.login),
    discordServerId: String(getHardcodedGuildId()),
    dshAuthMode: 'spmt',
    isLoggedIn: true,
    isAdmin: spmtIdentityIsAdmin(user),
    role,
  };
}

const SPMT_REQUEST_TIMEOUT_MS = 5000;

function spmtAbortSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(SPMT_REQUEST_TIMEOUT_MS);
}

export async function resolveSpmtSession(token: string, knownIdentity?: any): Promise<{ token: string; session: DshSpmtSession; identity: any }> {
  let user = knownIdentity;

  if (!user?.id) {
    const profileResponse = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: spmtAbortSignal(),
    });

    if (!profileResponse.ok) throw new Error(`SPMT userinfo lookup failed (${profileResponse.status})`);

    const data = await profileResponse.json();
    user = data?.user || data?.profile || data;
    if (!user?.id) throw new Error('SPMT userinfo did not return an identity');
  }

  return { token, session: buildDshSpmtSession(user), identity: user };
}
