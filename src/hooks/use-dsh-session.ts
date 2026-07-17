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

export function useDshSession() {
  const [session, setSession] = React.useState<DshSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    async function resolveSession() {
      const spmtResponse = await fetch('/api/auth/spmt-session', { cache: 'no-store', credentials: 'include' }).catch(() => null);
      const spmtData = spmtResponse?.ok ? await spmtResponse.json() : null;
      if (spmtData?.success) return spmtData.session as DshSession;

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
    resolveSession()
      .then((resolved) => { if (!cancelled) setSession(resolved); })
      .catch(() => { if (!cancelled) setSession(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { session, loading };
}
