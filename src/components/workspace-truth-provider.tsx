'use client';

import * as React from 'react';
import type { WorkspaceThemeTokensV1 } from '@spmt/sdk';
import { applyWorkspaceThemeTokens, clearWorkspaceThemeTokens } from '@/lib/workspace-theme';

const REFRESH_MS = 30_000;

export function WorkspaceTruthProvider({ children }: { children: React.ReactNode }) {
  const revisionRef = React.useRef<number | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch('/api/spmt/workspace-theme', {
        cache: 'no-store',
        credentials: 'include',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.tokens) {
        if (response.status === 401) clearWorkspaceThemeTokens(document.documentElement);
        return;
      }
      const revision = Number(body.revision || 0);
      if (revisionRef.current === revision && document.documentElement.dataset.workspaceTheme) return;
      applyWorkspaceThemeTokens(document.documentElement, body.tokens as WorkspaceThemeTokensV1);
      revisionRef.current = revision;
      window.dispatchEvent(new CustomEvent('spmt-workspace-updated', { detail: body }));
    } catch {
      // Keep the last successfully applied canonical workspace while temporarily offline.
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onSession = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('dsh-session-restored', onSession);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('dsh-session-restored', onSession);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return <>{children}</>;
}
