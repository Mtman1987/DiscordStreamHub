'use client';

import * as React from 'react';

export type DshSession = {
  spmtUserId?: string;
  spmtUsername?: string;
  discordUserId?: string;
  discordUsername?: string;
  discordDisplayName?: string;
  twitchUsername?: string;
  discordServerId?: string;
  legacy?: boolean;
};

const SESSION_CACHE_KEY = 'spmt.cache.v1.discord-stream-hub.session';

type CachedSessionEnvelope = {
  version: 1;
  savedAt: string;
  session: DshSession;
};

function readCachedSession(): DshSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(SESSION_CACHE_KEY) || 'null') as CachedSessionEnvelope | null;
    if (!cached || cached.version !== 1 || !cached.session) return null;
    return cached.session;
  } catch {
    return null;
  }
}

function writeCachedSession(session: DshSession) {
  try {
    window.localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      session,
    } satisfies CachedSessionEnvelope));
  } catch {
    // A disabled/full cache must never block the live session.
  }
}

function clearCachedSession() {
  try { window.localStorage.removeItem(SESSION_CACHE_KEY); } catch {}
}

export function useDshSession() {
  const [session, setSession] = React.useState<DshSession | null>(() => readCachedSession());
  const [loading, setLoading] = React.useState(() => !readCachedSession());

  React.useEffect(() => {
    let cancelled = false;

    async function resolveLegacySession() {
      const userId = window.localStorage.getItem('discordUserId') || '';
      const serverId = window.localStorage.getItem('discordServerId') || '';
      if (!userId || !serverId) return null;
      const params = new URLSearchParams({ userId, serverId });
      const legacyResponse = await fetch(`/api/auth/restore-session?${params}`, { cache: 'no-store' }).catch(() => null);
      const legacy = legacyResponse?.ok ? await legacyResponse.json() : null;
      if (!legacy?.success || !legacy?.userMatched || String(legacy.discordUserId || legacy.userId) !== userId) return null;
      return {
        legacy: true,
        discordServerId: String(legacy.serverId || serverId),
        discordUserId: userId,
        discordUsername: String(legacy.discordUsername || ''),
        discordDisplayName: String(legacy.discordDisplayName || legacy.discordUsername || userId),
        twitchUsername: String(legacy.twitchUsername || ''),
      } satisfies DshSession;
    }

    async function refreshSession() {
      const spmtResponse = await fetch('/api/auth/spmt-session', {
        cache: 'no-store',
        credentials: 'include',
      }).catch(() => null);

      if (spmtResponse?.ok) {
        const spmtData = await spmtResponse.json().catch(() => null);
        if (spmtData?.success && spmtData.session) return { session: spmtData.session as DshSession, definitive: true };
      }

      // A network/5xx failure is transient. Keep the restored shell rather than
      // flashing a sign-in screen while SPMT or the network recovers.
      const definitiveAuthFailure = Boolean(spmtResponse && (spmtResponse.status === 401 || spmtResponse.status === 403));
      if (!definitiveAuthFailure) return { session: readCachedSession(), definitive: false };

      const legacy = await resolveLegacySession();
      return { session: legacy, definitive: true };
    }

    refreshSession()
      .then((result) => {
        if (cancelled) return;
        if (result.session) {
          writeCachedSession(result.session);
          setSession(result.session);
        } else if (result.definitive) {
          clearCachedSession();
          setSession(null);
        }
      })
      .catch(() => {
        // The cached shell is intentionally retained on transient refresh errors.
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { session, loading };
}
