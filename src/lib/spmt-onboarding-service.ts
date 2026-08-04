import 'server-only';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { getAppUrl, getTwitchClientId } from '@/lib/runtime-config';

const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

function stateHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSpmtOnboardingAuthorization(input: {
  serverId: string;
  discordUserId: string;
  discordUsername: string;
  discordDisplayName: string;
  discordAvatarUrl?: string;
  roles: string[];
}) {
  const stateToken = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const staleStates = await db.collection('oauthStates').get();
  for (const document of staleStates.docs) {
    if (Number(document.data()?.expiresAt || 0) <= now) await document.ref.delete();
  }
  const id = stateHash(stateToken);
  db.set('oauthStates', id, {
    purpose: 'spmt-onboard',
    ...input,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + OAUTH_STATE_TTL_MS,
  });
  if (!db.get('oauthStates', id)) throw new Error('SPMT onboarding state could not be saved.');

  const authorizeUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', getTwitchClientId());
  authorizeUrl.searchParams.set('redirect_uri', `${getAppUrl().replace(/\/$/, '')}/api/twitch/oauth/callback`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', '');
  authorizeUrl.searchParams.set('force_verify', 'true');
  authorizeUrl.searchParams.set('state', `spmt-onboard|${stateToken}`);
  return authorizeUrl.toString();
}

export async function consumeSpmtOnboardingState(stateToken: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(stateToken)) return null;
  const id = stateHash(stateToken);
  const data = db.get('oauthStates', id);
  if (!data) return null;
  // The compatibility database operations are synchronous, so read + delete
  // completes before another callback can consume the same state in this process.
  db.delete('oauthStates', id);
  if (data?.purpose !== 'spmt-onboard' || Number(data?.expiresAt || 0) <= Date.now()) return null;
  if (!data?.serverId || !data?.discordUserId || !data?.discordUsername) return null;
  return {
    serverId: String(data.serverId),
    discordUserId: String(data.discordUserId),
    discordUsername: String(data.discordUsername),
    discordDisplayName: String(data.discordDisplayName || data.discordUsername),
    discordAvatarUrl: String(data.discordAvatarUrl || ''),
    roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
  };
}
