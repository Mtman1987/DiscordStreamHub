import { sqliteService } from './sqlite-service';

const COLLECTION = 'relayPresence';
export const RELAY_VOICE_FRESH_MS = 90_000;
export const RELAY_CHAT_FRESH_MS = 10 * 60_000;

type RelayPresenceRow = {
  userId: string;
  guildId: string;
  username?: string;
  displayName?: string;
  voiceChannelId?: string;
  voiceChannelName?: string;
  voiceObservedAt?: string;
  lastChatChannelId?: string;
  lastChatChannelName?: string;
  lastChatAt?: string;
  updatedAt: string;
};

export type RelayPresenceSnapshot = RelayPresenceRow & {
  found: true;
  inVoice: boolean;
  recentlyChatting: boolean;
  preferredKind: 'voice' | 'chat' | null;
  preferredChannelId: string | null;
  preferredChannelName: string | null;
};

function clean(value: unknown, max = 200): string {
  return String(value || '').trim().slice(0, max);
}

function normalizedName(value: unknown): string {
  return clean(value, 120).replace(/^@/, '').toLowerCase();
}

function timestamp(value?: unknown): string {
  const raw = clean(value, 80);
  if (raw && Number.isFinite(Date.parse(raw))) return new Date(raw).toISOString();
  return new Date().toISOString();
}

function docId(guildId: string, userId: string): string {
  return `${guildId.replace(/[^A-Za-z0-9_-]/g, '_')}_${userId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function readRow(guildId: string, userId: string): RelayPresenceRow | null {
  const existing = sqliteService.getDoc(`${COLLECTION}/${docId(guildId, userId)}`);
  return existing.exists && existing.data && typeof existing.data === 'object'
    ? existing.data as RelayPresenceRow
    : null;
}

function snapshot(row: RelayPresenceRow | undefined, nowMs: number): RelayPresenceSnapshot | null {
  if (!row) return null;
  const voiceAge = row.voiceObservedAt ? nowMs - Date.parse(row.voiceObservedAt) : Number.POSITIVE_INFINITY;
  const chatAge = row.lastChatAt ? nowMs - Date.parse(row.lastChatAt) : Number.POSITIVE_INFINITY;
  const inVoice = Boolean(row.voiceChannelId && voiceAge >= 0 && voiceAge <= RELAY_VOICE_FRESH_MS);
  const recentlyChatting = Boolean(row.lastChatChannelId && chatAge >= 0 && chatAge <= RELAY_CHAT_FRESH_MS);
  const preferredKind = inVoice ? 'voice' : recentlyChatting ? 'chat' : null;
  return {
    ...row,
    found: true,
    inVoice,
    recentlyChatting,
    preferredKind,
    preferredChannelId: inVoice ? row.voiceChannelId || null : recentlyChatting ? row.lastChatChannelId || null : null,
    preferredChannelName: inVoice ? row.voiceChannelName || null : recentlyChatting ? row.lastChatChannelName || null : null,
  };
}

export function recordRelayChatActivity(input: {
  userId: string;
  guildId: string;
  username?: string;
  displayName?: string;
  channelId: string;
  channelName?: string;
  voiceChannelId?: string;
  voiceChannelName?: string;
  observedAt?: string;
}): RelayPresenceRow | null {
  const userId = clean(input.userId, 80);
  const guildId = clean(input.guildId, 80);
  const channelId = clean(input.channelId, 80);
  if (!userId || !guildId || !channelId) return null;
  const observedAt = timestamp(input.observedAt);
  const existing = readRow(guildId, userId);
  const voiceChannelId = clean(input.voiceChannelId, 80);
  const row: RelayPresenceRow = {
    ...(existing || {}),
    userId,
    guildId,
    username: clean(input.username, 120) || existing?.username,
    displayName: clean(input.displayName, 120) || existing?.displayName,
    lastChatChannelId: channelId,
    lastChatChannelName: clean(input.channelName, 120) || undefined,
    lastChatAt: observedAt,
    ...(voiceChannelId ? {
      voiceChannelId,
      voiceChannelName: clean(input.voiceChannelName, 120) || undefined,
      voiceObservedAt: observedAt,
    } : {}),
    updatedAt: observedAt,
  };
  sqliteService.setDoc(`${COLLECTION}/${docId(guildId, userId)}`, row, false);
  return row;
}

export function recordRelayVoicePresence(input: {
  userId: string;
  guildId: string;
  username?: string;
  displayName?: string;
  channelId?: string | null;
  channelName?: string | null;
  observedAt?: string;
}): RelayPresenceRow | null {
  const userId = clean(input.userId, 80);
  const guildId = clean(input.guildId, 80);
  if (!userId || !guildId) return null;
  const observedAt = timestamp(input.observedAt);
  const existing = readRow(guildId, userId);
  const channelId = clean(input.channelId, 80);
  const row: RelayPresenceRow = {
    ...(existing || {}),
    userId,
    guildId,
    username: clean(input.username, 120) || existing?.username,
    displayName: clean(input.displayName, 120) || existing?.displayName,
    voiceChannelId: channelId || undefined,
    voiceChannelName: channelId ? clean(input.channelName, 120) || undefined : undefined,
    voiceObservedAt: observedAt,
    updatedAt: observedAt,
  };
  sqliteService.setDoc(`${COLLECTION}/${docId(guildId, userId)}`, row, false);
  return row;
}

export function getRelayPresence(userIdInput: string, guildIdInput?: string, nowMs = Date.now()): RelayPresenceSnapshot | null {
  const userId = clean(userIdInput, 80);
  const guildId = clean(guildIdInput, 80);
  if (!userId) return null;
  const row = sqliteService.getCollection(COLLECTION).docs
    .filter((entry: any) => String(entry.userId || '') === userId && (!guildId || String(entry.guildId || '') === guildId))
    .sort((a: any, b: any) => Date.parse(String(b.updatedAt || 0)) - Date.parse(String(a.updatedAt || 0)))[0] as RelayPresenceRow | undefined;
  return snapshot(row, nowMs);
}

export function getRelayPresenceByName(nameInput: string, guildIdInput?: string, nowMs = Date.now()): RelayPresenceSnapshot | null {
  const name = normalizedName(nameInput);
  const guildId = clean(guildIdInput, 80);
  if (!name) return null;
  const row = sqliteService.getCollection(COLLECTION).docs
    .filter((entry: any) => {
      if (guildId && String(entry.guildId || '') !== guildId) return false;
      return normalizedName(entry.username) === name || normalizedName(entry.displayName) === name;
    })
    .sort((a: any, b: any) => Date.parse(String(b.updatedAt || 0)) - Date.parse(String(a.updatedAt || 0)))[0] as RelayPresenceRow | undefined;
  return snapshot(row, nowMs);
}
