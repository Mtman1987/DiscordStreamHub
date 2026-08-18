import { SPMT_BASE_URL } from './spmt-session';

type ServiceToken = { token: string; expiresAt: number; scopes: string[] };
let cached: ServiceToken | null = null;

export async function getSpmtServiceToken(scopes: string[]): Promise<string> {
  const requested = Array.from(new Set(scopes.map((value) => String(value || '').trim()).filter(Boolean))).sort();
  const now = Date.now();
  if (cached && cached.expiresAt - now > 60_000 && requested.every((scope) => cached!.scopes.includes(scope))) {
    return cached.token;
  }

  const clientSecret = String(process.env.DSH_CLIENT_SECRET || '').trim();
  if (!clientSecret) throw new Error('DSH SPMT OAuth client secret is not configured');
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'discord-stream-hub',
      client_secret: clientSecret,
      scope: requested.join(' '),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) {
    throw new Error(String(payload?.error || `SPMT service token exchange failed (${response.status})`));
  }
  const expiresIn = Math.max(60, Number(payload.expires_in || 3600));
  cached = { token: String(payload.access_token), expiresAt: now + expiresIn * 1000, scopes: requested };
  return cached.token;
}

export function clearSpmtServiceTokenCache() {
  cached = null;
}
