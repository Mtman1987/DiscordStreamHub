'use client';

import * as React from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExternalLink } from 'lucide-react';

export default function LoggedOutPage() {
  const [loginUrl, setLoginUrl] = React.useState('/login?loggedOut=1');

  React.useEffect(() => {
    setLoginUrl(`${window.location.origin}/login?loggedOut=1`);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="relative mx-auto mb-4 h-24 w-40">
            <Image
              src="/brand/discord-stream-hub-logo.png"
              alt="Discord Stream Hub"
              fill
              priority
              className="object-contain"
            />
          </div>
          <CardTitle>Logged out</CardTitle>
          <CardDescription>
            This embedded Discord Stream Hub session has been cleared.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href={loginUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open login in a new tab
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
