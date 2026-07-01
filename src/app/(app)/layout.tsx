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
  SidebarSeparator,
} from '@/components/ui/sidebar';
import Link from 'next/link';
import { Rocket } from 'lucide-react';
import { MainNav } from './_components/main-nav';
import { UserNav } from './_components/user-nav';
import { DataClientProvider } from '@/data';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionReady, setSessionReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        const existingServerId = window.localStorage.getItem('discordServerId');
        const searchParams = new URLSearchParams(window.location.search);
        const queryServerId = searchParams.get('serverId') || searchParams.get('guildId') || searchParams.get('discordServerId');
        const query = queryServerId ? `?serverId=${encodeURIComponent(queryServerId)}` : '';
        const response = await fetch(`/api/auth/restore-session${query}`, { cache: 'no-store' });
        const data = response.ok ? await response.json() : null;

        if (cancelled) return;

        if (data?.success && data.serverId) {
          window.localStorage.setItem('discordServerId', data.serverId);
          if (data.discordUserId || data.userId) window.localStorage.setItem('discordUserId', data.discordUserId || data.userId);
          if (data.twitchUsername) window.localStorage.setItem('twitchUsername', data.twitchUsername);
          if (data.discordUsername) window.localStorage.setItem('discordUsername', data.discordUsername);
          if (data.discordDisplayName) window.localStorage.setItem('discordDisplayName', data.discordDisplayName);
          if (data.discordAvatar) window.localStorage.setItem('discordAvatar', data.discordAvatar);
          if (data.serverName) window.localStorage.setItem('serverName', data.serverName);
          if (data.iconUrl) window.localStorage.setItem('serverIconUrl', data.iconUrl);
          window.localStorage.setItem('isLoggedIn', 'true');
          window.dispatchEvent(new Event('dsh-session-restored'));
          setSessionReady(true);
          return;
        }

        if (existingServerId || window.localStorage.getItem('isLoggedIn') === 'true') {
          setSessionReady(true);
          return;
        }

        router.replace(`/login?next=${encodeURIComponent(pathname || '/dashboard')}`);
      } catch (error) {
        if (cancelled) return;
        if (window.localStorage.getItem('discordServerId') || window.localStorage.getItem('isLoggedIn') === 'true') {
          setSessionReady(true);
          return;
        }
        router.replace(`/login?next=${encodeURIComponent(pathname || '/dashboard')}`);
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

  return (
    <DataClientProvider>
      <SidebarProvider collapsible="icon">
        <div className="flex min-h-screen">
          <Sidebar className="border-r group">
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
            <SidebarContent className="p-4">
              <MainNav />
            </SidebarContent>
            <SidebarFooter className="p-4 space-y-4">
              <UserNav />
              <SidebarSeparator />
              <div className="text-center text-xs text-muted-foreground group-data-[collapsed=true]:hidden">
                <div>For the Space Mountain Admin</div>
                <div>powered by Mtman1987 <Rocket className="inline h-3 w-3" /></div>
              </div>
            </SidebarFooter>
          </Sidebar>
          <div className="flex flex-1 flex-col">
            <header className="flex h-14 items-center gap-4 border-b bg-card px-6">
              <div className="md:hidden">
                <SidebarTrigger />
              </div>
              <div className="flex-1">
                {/* Future header content can go here, like a search bar */}
              </div>
            </header>
            <main className="flex-1 overflow-y-auto p-4 md:p-8">
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </DataClientProvider>
  );
}
