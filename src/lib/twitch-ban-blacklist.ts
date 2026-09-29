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


export function buildTwitchBanUserDm(snapshot: TwitchBanProfileSnapshot): string {
  const name = String(snapshot.displayName || snapshot.channel || 'there').trim();
  return [
    `Hi ${name}. The SPMT Twitch bot was automatically removed after Twitch reported that the bot account is banned in #${snapshot.channel}.`,
    '',
    'If you do not want SPMT bots or the SPMT system in your channel, send `spmt opt-out` to the SPMT bot on Discord. That permanently opts the linked Twitch channel out so the bots and automated services stop trying to join or contact the channel.',
    '',
    'If you do not opt out, this is treated as an ongoing ban rather than an opt-out: the channel stays quarantined, and mtman1987 will also remain blocked from that Twitch channel/account until you manually restore access.',
    '',
    'This notice is sent once. Existing blacklist entries are not contacted again.',
  ].join('\n');
}
