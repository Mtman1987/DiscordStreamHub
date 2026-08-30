import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { deleteDiscordMessage } from '@/lib/discord-sync-service';
import { getAppUrl } from '@/lib/runtime-config';
import { getBotServiceSecret } from '@/lib/runtime-secrets';
import { resolveSpmtSession, type DshSpmtSession } from '@/lib/spmt-session';

const SIGNAL_CONTROL_PATH = '/signal/remove';
const SIGNAL_CONTROL_TTL_SECONDS = 90 * 24 * 60 * 60;
const SIGNAL_CONTROL_FIELD_NAME = '\u200B';

type SignalControlPayload = {
  v: 1;
  s: string;
  r: string;
  e: number;
};

type SignalRecord = {
  id?: string;
  kind?: 'manual' | 'signal';
  channelId?: string;
  messageId?: string;
  requesterName?: string;
  requesterDiscordId?: string | null;
  suppressedAt?: string | null;
};

function controlSecret(): string {
  const secret = getBotServiceSecret();
  if (!secret) throw new Error('Signal shoutout controls require the existing DSH service credential.');
  return secret;
}

function sign(encoded: string): string {
  return createHmac('sha256', controlSecret())
    .update(encoded)
    .digest()
    .subarray(0, 18)
    .toString('base64url');
}

function safeEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160;
}

function normalizeTwitchLogin(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 25);
}

export function createSignalShoutoutControlToken(input: {
  serverId: string;
  recordId: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}): string {
  if (!validId(input.serverId) || !validId(input.recordId)) {
    throw new Error('Signal shoutout controls require a server and record id.');
  }
  const nowSeconds = Math.floor(input.nowSeconds ?? Date.now() / 1000);
  const ttlSeconds = Math.max(60, Math.floor(input.ttlSeconds ?? SIGNAL_CONTROL_TTL_SECONDS));
  const payload: SignalControlPayload = {
    v: 1,
    s: input.serverId.trim(),
    r: input.recordId.trim(),
    e: nowSeconds + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifySignalShoutoutControlToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SignalControlPayload | null {
  const [encoded, signature, ...extra] = String(token || '').trim().split('.');
  if (!encoded || !signature || extra.length || !safeEqual(signature, sign(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SignalControlPayload>;
    if (payload.v !== 1 || !validId(payload.s) || !validId(payload.r)) return null;
    const expiresAt = Number(payload.e);
    if (!Number.isSafeInteger(expiresAt) || expiresAt < nowSeconds) return null;
    if (expiresAt > nowSeconds + SIGNAL_CONTROL_TTL_SECONDS + 300) return null;
    return { v: 1, s: payload.s.trim(), r: payload.r.trim(), e: expiresAt };
  } catch {
    return null;
  }
}

export function buildSignalShoutoutControlField(input: {
  serverId: string;
  recordId: string;
}): { name: string; value: string; inline: false } {
  const token = createSignalShoutoutControlToken(input);
  const url = new URL(SIGNAL_CONTROL_PATH, getAppUrl());
  url.searchParams.set('k', token);
  return {
    name: SIGNAL_CONTROL_FIELD_NAME,
    value: `[🗑️](${url.toString()})`,
    inline: false,
  };
}

function sessionMatchesRequester(session: DshSpmtSession, entry: SignalRecord): boolean {
  const actorDiscordId = String(session.discordUserId || '').trim();
  const requesterDiscordId = String(entry.requesterDiscordId || '').trim();
  if (actorDiscordId && requesterDiscordId && actorDiscordId === requesterDiscordId) return true;

  const actorTwitch = normalizeTwitchLogin(session.twitchUsername);
  const requesterTwitch = normalizeTwitchLogin(entry.requesterName);
  return Boolean(actorTwitch && requesterTwitch && actorTwitch === requesterTwitch);
}

export async function removeSignalShoutoutFromWebControl(input: {
  controlToken: string;
  spmtAccessToken: string;
}): Promise<{ ok: boolean; authorized: boolean; alreadyRemoved?: boolean; message: string }> {
  const control = verifySignalShoutoutControlToken(input.controlToken);
  if (!control) return { ok: false, authorized: false, message: 'This Signal control link is invalid or expired.' };

  const resolved = await resolveSpmtSession(input.spmtAccessToken).catch(() => null);
  if (!resolved) return { ok: false, authorized: false, message: 'Sign in to DiscordStreamHub before removing this Signal.' };

  const ref = db.collection('servers').doc(control.s).collection('manualDiscordShoutouts').doc(control.r);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return { ok: true, authorized: true, alreadyRemoved: true, message: 'This Signal is already out of rotation.' };
  }

  const entry = snapshot.data() as SignalRecord;
  if ((entry.kind || 'manual') !== 'signal') {
    return { ok: false, authorized: false, message: 'This control only applies to Signal shoutouts.' };
  }

  if (entry.suppressedAt) {
    return { ok: true, authorized: true, alreadyRemoved: true, message: 'This Signal is already out of rotation.' };
  }

  const authorized = resolved.session.isAdmin || sessionMatchesRequester(resolved.session, entry);
  if (!authorized) {
    return {
      ok: false,
      authorized: false,
      message: 'Only the person who sent this Signal or an approved DSH administrator can remove it.',
    };
  }

  const nowIso = new Date().toISOString();
  await ref.set({
    suppressedAt: nowIso,
    trackWhileLive: false,
    updatedAt: nowIso,
  }, { merge: true });

  const channelId = String(entry.channelId || '').trim();
  const messageId = String(entry.messageId || '').trim();
  if (channelId && messageId) {
    await deleteDiscordMessage(control.s, channelId, messageId).catch(() => {});
  }

  return {
    ok: true,
    authorized: true,
    message: 'Signal removed from the live shoutout rotation.',
  };
}
