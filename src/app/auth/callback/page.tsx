'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

function writeSession(session: Record<string, string>) {
  for (const [key, value] of Object.entries(session)) {
    if (value) localStorage.setItem(key, value);
  }
  localStorage.setItem('isLoggedIn', 'true');
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = React.useState('Completing SPMT sign in...');

  React.useEffect(() => {
    let cancelled = false;

    async function completeLogin() {
      const searchParams = new URLSearchParams(window.location.search);
      const token = searchParams.get('auth_code') || searchParams.get('token') || searchParams.get('code') || '';
      const next = searchParams.get('next') || '/dashboard';

      if (!token) {
        setMessage('Missing SPMT sign-in token. Return to login and try again.');
        return;
      }

      try {
        const sessionResponse = await fetch('/api/auth/spmt-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          credentials: 'include',
        });
        if (!sessionResponse.ok) throw new Error('SPMT session exchange failed');
        const data = await sessionResponse.json();
        const session = (data.session || {}) as Record<string, string>;
        writeSession(session);

        if (!cancelled && window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'DSH_SPMT_AUTH_COMPLETE', session, next }, window.location.origin);
          setMessage('SPMT sign in complete. Returning to the chat popout...');
          setTimeout(() => window.close(), 600);
          return;
        }

        if (!cancelled) router.replace(next.startsWith('/') ? next : '/dashboard');
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
