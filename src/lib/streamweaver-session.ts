export type VerifiedStreamWeaverSession = {
  id: string;
  username: string;
  displayName?: string;
};

type SessionVerifierDependencies = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function verifyStreamWeaverSessionToken(
  token: string,
  dependencies: SessionVerifierDependencies = {},
): Promise<VerifiedStreamWeaverSession | null> {
  const normalized = String(token || '').trim();
  if (!normalized || normalized.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(normalized)) return null;
  const configuredBaseUrl = dependencies.baseUrl || (await import('@/lib/runtime-config')).getStreamweaverUrl();
  const baseUrl = configuredBaseUrl.replace(/\/$/, '');
  const response = await (dependencies.fetchImpl || fetch)(`${baseUrl}/api/session`, {
    headers: {
      Accept: 'application/json',
      Cookie: `streamweaver-session=${normalized}`,
    },
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8_000)
      : undefined,
  }).catch(() => null);
  if (!response?.ok) return null;
  const session = await response.json().catch(() => null) as any;
  const id = String(session?.id || '').trim();
  const username = String(session?.username || '').trim();
  if (!id || !username) return null;
  return {
    id,
    username,
    displayName: String(session?.displayName || '').trim() || undefined,
  };
}
