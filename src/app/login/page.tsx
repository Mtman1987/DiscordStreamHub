'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LogIn, ShieldCheck, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

function getSafeNextPath(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

function applySessionPayload(payload: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      localStorage.setItem(key, String(value));
    }
  }
  localStorage.setItem('isLoggedIn', 'true');
}

function applyServerIdFromNext(nextPath: string) {
  try {
    const url = new URL(nextPath, window.location.origin);
    const serverId = url.searchParams.get('serverId') || url.searchParams.get('guildId') || url.searchParams.get('discordServerId');
    if (serverId) localStorage.setItem('discordServerId', serverId);
  } catch {}
}

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = React.useState('/dashboard');

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(getSafeNextPath(params.get('next')));
  }, []);

  React.useEffect(() => {
    function finishLogin(session?: Record<string, unknown>, returnPath = nextPath) {
      const safeReturnPath = getSafeNextPath(returnPath);
      applySessionPayload(session);
      applyServerIdFromNext(safeReturnPath);
      window.dispatchEvent(new Event('dsh-session-restored'));
      router.replace(safeReturnPath);
    }

    function handleAuthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'DSH_SPMT_AUTH_COMPLETE') return;
      finishLogin(event.data?.session || {}, event.data?.next || nextPath);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === 'isLoggedIn' && event.newValue === 'true') {
        applyServerIdFromNext(nextPath);
        router.replace(nextPath);
      }
    }

    window.addEventListener('message', handleAuthMessage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('message', handleAuthMessage);
      window.removeEventListener('storage', handleStorage);
    };
  }, [nextPath, router]);

  const handleSpmtLogin = () => {
    const startUrl = `/api/auth/spmt-login?next=${encodeURIComponent(nextPath)}`;
    const popup = window.open(startUrl, 'dsh-spmt-auth', 'popup=yes,width=520,height=760');
    if (!popup) window.location.href = startUrl;
  };
  
  const handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div>
          <CardHeader className="text-center">
            <div className="relative mx-auto mb-4 h-32 w-52">
              <Image
                src="/brand/discord-stream-hub-logo.png"
                alt="Discord Stream Hub"
                fill
                priority
                className="object-contain"
              />
            </div>
            <CardTitle className="font-headline text-2xl">
              Welcome to Discord Stream Hub
            </CardTitle>
            <CardDescription>
              Enter your details to access your community dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4" />
                Sign in with SPMT
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                Use your SPMT account as the ecosystem identity for Discord Stream Hub. Existing legacy sessions continue automatically while they are grandfathered.
              </p>
              <Button type="button" className="w-full" onClick={handleSpmtLogin}>
                <LogIn className="mr-2 h-4 w-4" />
                Continue with SPMT
              </Button>
              <Button asChild variant="link" className="mt-1 w-full">
                <a href="https://spmt.live/?view=connections" target="_blank" rel="noopener noreferrer">Authorize Twitch / Discord in SPMT</a>
              </Button>
            </div>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-4">
            <Button type="button" variant="outline" className="w-full" onClick={handleReset}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Session & Reload
            </Button>
          </CardFooter>
        </div>
      </Card>
    </main>
  );
}
