import { SPMT_BASE_URL } from './spmt-session';

type ServiceToken = { token: string; expiresAt: number; scopes: string[] };
const cached = new Map<string, ServiceToken>();
const inFlight = new Map<string, Promise<string>>();

function normalizeScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.map((value) => String(value || '').trim()).filter(Boolean))).sort();
}

export async function getSpmtServiceToken(scopes: string[]): Promise<string> {
  const requested = normalizeScopes(scopes);
  if (!requested.length) throw new Error('At least one DSH SPMT OAuth service scope is required');
  const key = requested.join(' ');
  const now = Date.now();
  const current = cached.get(key);
  if (current && current.expiresAt - now > 60_000) return current.token;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const mint = (async () => {
    const clientSecret = String(process.env.DSH_CLIENT_SECRET || '').trim();
    if (!clientSecret) throw new Error('DSH SPMT OAuth client secret is not configured');
    const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: 'discord-stream-hub',
        client_secret: clientSecret,
        scope: key,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || !payload?.access_token) {
      throw new Error(String(payload?.error || `SPMT service token exchange failed (${response.status})`));
    }
    const expiresIn = Math.max(60, Number(payload.expires_in || 3600));
    const grantedScopes = Array.isArray(payload?.scopes)
      ? normalizeScopes(payload.scopes.map(String))
      : requested;
    cached.set(key, { token: String(payload.access_token), expiresAt: Date.now() + expiresIn * 1000, scopes: grantedScopes });
    return String(payload.access_token);
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, mint);
  return mint;
}

export function clearSpmtServiceTokenCache() {
  cached.clear();
  inFlight.clear();
}
