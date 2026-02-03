'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/firebase';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthChecked, setIsAuthChecked] = useState(false);

  useEffect(() => {
    if (!isUserLoading) {
      const hasSession = localStorage.getItem('isLoggedIn') === 'true' && localStorage.getItem('discordServerId');
      if (!user || !hasSession) {
        // Allow access to login page without redirect loop
        if (pathname !== '/login') {
          router.push('/login');
        }
      } else {
        setIsAuthChecked(true);
      }
    }
  }, [user, isUserLoading, router, pathname]);

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
