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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, ShieldCheck, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Separator } from '@/components/ui/separator';

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
  const spmtAuthorizeUrl = 'https://spmt.live/api/oauth/authorize?client_id=discord-stream-hub&redirect_uri=https%3A%2F%2Fdiscord-stream-hub-new.fly.dev%2Fauth%2Fcallback';

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(getSafeNextPath(params.get('next')));
  }, []);

  React.useEffect(() => {
    function finishLogin(session?: Record<string, unknown>) {
      applySessionPayload(session);
      applyServerIdFromNext(nextPath);
      window.dispatchEvent(new Event('dsh-session-restored'));
      router.replace(nextPath);
    }

    function handleAuthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'DSH_SPMT_AUTH_COMPLETE') return;
      finishLogin(event.data?.session || {});
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

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const discordServerId = formData.get('discord-server-id') as string;
    const discordUserId = formData.get('discord-user-id') as string;
    const twitchUsername = formData.get('twitch-username') as string;

    // Store the IDs in localStorage to simulate a session
    localStorage.setItem('discordServerId', discordServerId);
    localStorage.setItem('discordUserId', discordUserId);
    localStorage.setItem('twitchUsername', twitchUsername);
    localStorage.setItem('isLoggedIn', 'true');
    
    router.push(nextPath);
  };

  const handleSpmtLogin = () => {
    const popup = window.open(spmtAuthorizeUrl, 'dsh-spmt-auth', 'popup=yes,width=520,height=760');
    if (!popup) window.location.href = spmtAuthorizeUrl;
  };
  
  const handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <form onSubmit={handleLogin}>
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
                Use your SPMT account as the ecosystem identity for Discord Stream Hub. Legacy manual login stays available below.
              </p>
              <Button type="button" className="w-full" onClick={handleSpmtLogin}>
                <LogIn className="mr-2 h-4 w-4" />
                Continue with SPMT
              </Button>
              <Button asChild variant="link" className="mt-1 w-full">
                <a href="https://spmt.live/?view=connections" target="_blank" rel="noopener noreferrer">Authorize Twitch / Discord in SPMT</a>
              </Button>
            </div>
            <div className="relative flex items-center justify-center">
              <Separator className="shrink" />
              <span className="absolute bg-card px-2 text-xs text-muted-foreground">Legacy manual session</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="discord-server-id">Discord Server ID</Label>
              <Input
                id="discord-server-id"
                name="discord-server-id"
                placeholder="Your server's unique ID"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discord-user-id">Discord User ID</Label>
              <Input
                id="discord-user-id"
                name="discord-user-id"
                placeholder="Your personal Discord ID"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="twitch-username">Twitch Username</Label>
              <Input
                id="twitch-username"
                name="twitch-username"
                placeholder="Your Twitch channel name"
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-4">
            <Button type="submit" className="w-full">
              <LogIn className="mr-2 h-4 w-4" />
              Continue
            </Button>
            <div className="relative flex items-center justify-center">
                <Separator className="shrink" />
                <span className="absolute bg-card px-2 text-xs text-muted-foreground">Or</span>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleReset}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Session & Reload
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
