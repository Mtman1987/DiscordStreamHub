export type TwitchBanProfileSnapshot = {
  channel: string;
  displayName?: string | null;
  twitchId?: string | null;
  discordUserId?: string | null;
  chatTagJoinedAt?: string | null;
  discordJoinedAt?: string | null;
  firstSeenAt?: string | null;
  lastPlayedAt?: string | null;
  daysPlayed?: number | null;
  tags?: number | null;
  tagged?: number | null;
};

export function isTwitchBanNotice(messageId: unknown, message?: unknown): boolean {
  const id = String(messageId || '').trim().toLowerCase();
  const detail = String(message || '').trim().toLowerCase();
  return id === 'msg_banned'
    || detail === 'msg_banned'
    || detail.includes('banned from this channel')
    || detail.includes('you are permanently banned');
}

function validDate(value: unknown): Date | null {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: unknown): string {
  const date = validDate(value);
  return date ? date.toISOString().slice(0, 10) : 'not available';
}

function elapsedDays(value: unknown, now: Date): number | null {
  const start = validDate(value);
  if (!start) return null;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
}

function numberOrUnknown(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : 'not available';
}

export function buildTwitchBanOwnerDm(snapshot: TwitchBanProfileSnapshot, now = new Date()): string {
  const joinedAt = snapshot.chatTagJoinedAt || snapshot.discordJoinedAt || snapshot.firstSeenAt || null;
  const playedFor = elapsedDays(joinedAt, now);
  const name = String(snapshot.displayName || snapshot.channel || 'Unknown').trim();

  return [
    '🚫 Automatic permanent Twitch blacklist',
    `Name: ${name}`,
    `Channel: #${snapshot.channel}`,
    `Twitch ID: ${snapshot.twitchId || 'not available'}`,
    `Discord user: ${snapshot.discordUserId ? `<@${snapshot.discordUserId}> (${snapshot.discordUserId})` : 'not available'}`,
    'Reason: the bot received msg_banned in this channel.',
    'Protection: DiscordStreamHub, StreamWeaver, and Chat Tag are blacklisted. An unban will not automatically add this channel back.',
    `Chat Tag join date: ${formatDate(snapshot.chatTagJoinedAt)}`,
    `Discord join date: ${formatDate(snapshot.discordJoinedAt)}`,
    `Known/playing for: ${playedFor === null ? 'not available' : `${playedFor} days`}`,
    `Days played: ${numberOrUnknown(snapshot.daysPlayed)}`,
    `Tags this month: ${numberOrUnknown(snapshot.tags)}`,
    `Times tagged this month: ${numberOrUnknown(snapshot.tagged)}`,
    `Last played: ${formatDate(snapshot.lastPlayedAt)}`,
  ].join('\n');
}
