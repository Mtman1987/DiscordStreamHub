import { getHardcodedGuildId } from '@/lib/runtime-config';

export const DSH_SPMT_COOKIE = 'dsh_spmt_session';
export const SPMT_BASE_URL = 'https://spmt.live';

function readDiscordId(user: any): string {
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : [];
  const discord = linkedAccounts.find((account: any) => account?.provider === 'discord') || user?.discord || {};
  return String(user?.discordUserId || user?.discord_user_id || user?.discordId || user?.discord_id || discord.id || discord.userId || '').trim();
}

function readTwitchUsername(user: any): string {
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : [];
  const twitch = linkedAccounts.find((account: any) => account?.provider === 'twitch') || user?.twitch || {};
  return String(user?.twitchUsername || user?.twitchLogin || user?.twitch_login || twitch.username || twitch.login || '').trim();
}

function readAvatarUrl(user: any): string {
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : [];
  const discord = linkedAccounts.find((account: any) => account?.provider === 'discord') || user?.discord || {};
  const twitch = linkedAccounts.find((account: any) => account?.provider === 'twitch') || user?.twitch || {};
  return String(
    user?.avatarUrl ||
    user?.avatar_url ||
    discord?.avatarUrl ||
    discord?.avatar_url ||
    twitch?.avatarUrl ||
    twitch?.avatar_url ||
    ''
  ).trim();
}

const SPMT_REQUEST_TIMEOUT_MS = 5000;

function spmtAbortSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(SPMT_REQUEST_TIMEOUT_MS);
}

export async function resolveSpmtSession(token: string) {
  const refreshResponse = await fetch(`${SPMT_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: spmtAbortSignal(),
  });
  const profileResponse = refreshResponse.ok
    ? refreshResponse
    : await fetch(`${SPMT_BASE_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: spmtAbortSignal(),
      });

  if (!profileResponse.ok) {
    throw new Error(`SPMT profile lookup failed (${profileResponse.status})`);
  }

  const data = await profileResponse.json();
  const user = data.user || data.profile || data;
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : [];
  const discord = linkedAccounts.find((account: any) => account?.provider === 'discord') || user?.discord || {};
  const discordUserId = readDiscordId(user);
  const twitchUsername = readTwitchUsername(user);
  const avatarUrl = readAvatarUrl(user);
  const discordUsername = String(user?.discordUsername || user?.discord_username || discord.username || user?.username || user?.displayName || '').trim();
  const discordDisplayName = String(user?.discordDisplayName || user?.discord_display_name || discord.displayName || discord.global_name || user?.displayName || discordUsername).trim();

  return {
    token: String(data.token || token),
    session: {
      ...(user?.id ? { spmtUserId: String(user.id) } : {}),
      ...(user?.username ? { spmtUsername: String(user.username) } : {}),
      ...(discordUserId ? { discordUserId } : {}),
      ...(discordUsername ? { discordUsername } : {}),
      ...(discordDisplayName ? { discordDisplayName } : {}),
      ...(avatarUrl ? { discordAvatar: avatarUrl } : {}),
      ...(twitchUsername ? { twitchUsername } : {}),
      discordServerId: String(getHardcodedGuildId()),
      dshAuthMode: 'spmt',
      isLoggedIn: true,
    },
  };
}
