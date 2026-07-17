'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthChecked, setIsAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/spmt-session', { cache: 'no-store', credentials: 'include' })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        const session = data?.session;
        if (ok && data?.success && (session?.spmtUserId || session?.discordUserId)) {
          setIsAuthChecked(true);
        } else if (pathname !== '/login') {
          router.replace('/login');
        }
      })
      .catch(() => { if (!cancelled && pathname !== '/login') router.replace('/login'); });
    return () => { cancelled = true; };
  }, [router, pathname]);

  if (!isAuthChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Authenticating...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
