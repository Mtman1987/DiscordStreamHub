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
import { BotMessageSquare, LogIn, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/firebase';
import { signInAnonymously } from 'firebase/auth';

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  
  React.useEffect(() => {
    if (auth) {
        signInAnonymously(auth).catch((error) => {
            console.error("Anonymous sign-in failed:", error);
        });
    }
  }, [auth]);

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
    
    router.push('/dashboard');
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
            <div className="mx-auto mb-4">
                <BotMessageSquare className="h-12 w-12 text-primary" />
            </div>
            <CardTitle className="font-headline text-2xl">
              Welcome to Cosmic Raid
            </CardTitle>
            <CardDescription>
              Enter your details to access your community dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
