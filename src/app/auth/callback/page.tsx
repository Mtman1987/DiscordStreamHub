'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

function getSafeNextPath(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith('/') && !text.startsWith('//') ? text : '/dashboard';
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = React.useState('Completing SPMT sign in...');

  React.useEffect(() => {
    let cancelled = false;

    async function completeLogin() {
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code') || '';
      const state = searchParams.get('state') || '';

      if (!code || !state) {
        setMessage('Missing or invalid SPMT authorization response. Return to login and try again.');
        return;
      }

      try {
        const sessionResponse = await fetch('/api/auth/spmt-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
          credentials: 'include',
        });
        if (!sessionResponse.ok) throw new Error('SPMT session exchange failed');
        const data = await sessionResponse.json();
        const session = (data.session || {}) as Record<string, string>;
        const next = getSafeNextPath(data.next);

        if (!cancelled && window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'DSH_SPMT_AUTH_COMPLETE', session, next }, window.location.origin);
          setMessage('SPMT sign in complete. Returning to the chat popout...');
          setTimeout(() => window.close(), 600);
          return;
        }

        if (!cancelled) router.replace(next);
      } catch (error) {
        console.error('[auth/callback] SPMT login failed', error);
        if (!cancelled) setMessage('SPMT sign in failed. Return to login and try again.');
      }
    }

    completeLogin();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      {message}
    </main>
  );
}
