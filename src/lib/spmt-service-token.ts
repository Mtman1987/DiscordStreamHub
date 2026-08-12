const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

type CachedToken = { token: string; expiresAt: number };
const cache = new Map<string, CachedToken>();

export async function getSpmtServiceToken(scopes: string[]): Promise<string> {
  const normalized = [...new Set(scopes.map((scope) => String(scope || '').trim()).filter(Boolean))].sort();
  if (!normalized.length) throw new Error('At least one SPMT service scope is required.');
  const cacheKey = normalized.join(' ');
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const clientSecret = String(process.env.DSH_CLIENT_SECRET || '').trim();
  if (!clientSecret) throw new Error('DSH SPMT OAuth client is not configured.');
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'discord-stream-hub',
      client_secret: clientSecret,
      scope: cacheKey,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(`SPMT service token exchange failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  const token = String(payload.access_token);
  const expiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000;
  cache.set(cacheKey, { token, expiresAt });
  return token;
}
