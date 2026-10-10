'use client';

import React from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { MainNav } from './_components/main-nav';
import { UserNav } from './_components/user-nav';
import { DataClientProvider } from '@/data';

const dshSessionKeys = [
  'discordUserId',
  'discordUsername',
  'discordDisplayName',
  'discordAvatar',
  'twitchUsername',
  // Legacy cleanup only. SPMT tokens now live in an HttpOnly cookie.
  'spmtToken',
  'spmtUserId',
  'spmtUsername',
  'isAdmin',
  'isLoggedIn',
  'dshAuthMode',
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionReady, setSessionReady] = React.useState(false);
  const [isEmbedded, setIsEmbedded] = React.useState(false);
  const sectionTitle = React.useMemo(() => {
    const section = pathname.split('/').filter(Boolean)[0] || 'dashboard';
    return section
      .split('-')
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ');
  }, [pathname]);

  React.useEffect(() => {
    setIsEmbedded(new URLSearchParams(window.location.search).get('embed') === '1');
  }, [pathname]);

  React.useEffect(() => {
    async function handleSpaceMountainAuth(event: MessageEvent) {
      const allowedOrigins = new Set([
        'https://spacemountain.live',
        'https://spmt.live',
        'http://localhost:3000',
        'http://localhost:5173',
      ]);
      if (!allowedOrigins.has(event.origin)) return;
      if (event.data?.type !== 'SPACEMOUNTAIN_AUTH') return;

      const token = typeof event.data?.token === 'string' ? event.data.token : '';
      if (!token) return;

      const response = await fetch('/api/auth/spmt-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'include',
      }).catch(() => null);
      const data = response?.ok ? await response.json() : null;
      const session = data?.session || {};
      if (!data?.success || (!session.spmtUserId && !session.discordUserId)) return;

      dshSessionKeys.forEach((key) => window.localStorage.removeItem(key));
      for (const [key, value] of Object.entries(session)) {
        if (value !== undefined && value !== null && value !== '') {
          window.localStorage.setItem(key, String(value));
        }
      }
      window.dispatchEvent(new Event('dsh-session-restored'));
      setSessionReady(true);
    }

    window.addEventListener('message', handleSpaceMountainAuth);
    window.parent?.postMessage({ type: 'SPACEMOUNTAIN_AUTH_REQUEST', source: 'discord-stream-hub' }, '*');
    return () => window.removeEventListener('message', handleSpaceMountainAuth);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        const response = await fetch('/api/auth/spmt-session', {
          cache: 'no-store', credentials: 'include',
        });
        const data = response.ok ? await response.json() : null;
        if (cancelled) return;
        if (!data?.success || !data.session?.spmtUserId) {
          if (response.status >= 500 && window.localStorage.getItem('spmtUserId')) {
            setSessionReady(true);
            return;
          }
          dshSessionKeys.forEach(key => window.localStorage.removeItem(key));
          window.localStorage.removeItem('discordServerId');
          router.replace('/login?next=' + encodeURIComponent(pathname || '/dashboard'));
          return;
        }
        for (const [key, value] of Object.entries(data.session)) {
          if (value !== undefined && value !== null) window.localStorage.setItem(key, String(value));
        }
        if (!data.session.discordServerId) {
          window.localStorage.removeItem('serverName');
          window.localStorage.removeItem('serverIconUrl');
          setSessionReady(true);
          if (pathname !== '/discord-servers') router.replace('/discord-servers');
          return;
        }
        // The server and identity come from the verified account. URL query
        // parameters and local user IDs never select the restored account.
        const restoredResponse = await fetch('/api/auth/restore-session', {
          cache: 'no-store', credentials: 'include',
        }).catch(() => null);
        const restored = restoredResponse?.ok ? await restoredResponse.json() : null;
        if (cancelled) return;
        if (restored?.success) {
          window.localStorage.setItem('serverName', restored.serverName || '');
          window.localStorage.setItem('serverIconUrl', restored.iconUrl || '');
          window.localStorage.setItem('isAdmin', restored.isAdmin ? 'true' : 'false');
        }
        window.dispatchEvent(new Event('dsh-session-restored'));
        setSessionReady(true);
      } catch {
        if (cancelled) return;
        if (window.localStorage.getItem('spmtUserId')) setSessionReady(true);
        else router.replace('/login?next=' + encodeURIComponent(pathname || '/dashboard'));
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking Discord Stream Hub session...
      </div>
    );
  }

  if (isEmbedded) {
    return (
      <DataClientProvider>
        <main className="h-screen min-h-0 overflow-hidden bg-background">{children}</main>
      </DataClientProvider>
    );
  }

  return (
    <DataClientProvider>
      <SidebarProvider collapsible="icon">
        <div className="flex h-screen overflow-hidden" data-workspace-shell>
          <Sidebar className="border-r group" data-workspace-sidebar>
            <SidebarHeader className="p-4 flex items-center justify-between">
              <Link
                href="/dashboard"
                className="flex items-center gap-2"
                prefetch={false}
              >
                <Image
                  src="/brand/discord-stream-hub-icon-192.png"
                  alt="Discord Stream Hub"
                  width={32}
                  height={32}
                  className="rounded-lg"
                  priority
                />
                <h2 className="font-headline text-lg font-semibold tracking-tight group-data-[collapsed=true]:hidden">
                  Discord Stream Hub
                </h2>
              </Link>
              <SidebarTrigger className="hidden md:flex" />
            </SidebarHeader>
            <SidebarContent className="p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <MainNav />
            </SidebarContent>
            <SidebarFooter className="px-4 pb-20 pt-4">
              <UserNav />
            </SidebarFooter>
          </Sidebar>
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex h-14 items-center gap-4 border-b bg-card px-6" data-workspace-topbar>
              <div className="md:hidden">
                <SidebarTrigger />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Space Mountain workspace
                </p>
                <h1 className="truncate text-base font-semibold">{sectionTitle}</h1>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs text-primary md:flex">
                <Sparkles className="h-3.5 w-3.5" />
                Shared appearance
              </div>
            </header>
            <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8" data-workspace-main>
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </DataClientProvider>
  );
}
