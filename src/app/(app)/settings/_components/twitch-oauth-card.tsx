'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, XCircle } from 'lucide-react';

interface TwitchOAuthCardProps {
  serverId: string;
}

export function TwitchOAuthCard({ serverId }: TwitchOAuthCardProps) {
  const [isConnected, setIsConnected] = React.useState(false);
  const [isChecking, setIsChecking] = React.useState(true);

  React.useEffect(() => {
    checkOAuthStatus();
    
    // Check for OAuth callback params
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'success') {
      setIsConnected(true);
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

  const checkOAuthStatus = async () => {
    try {
      const response = await fetch(`/api/twitch/oauth/status?serverId=${serverId}`);
      const data = await response.json();
      setIsConnected(data.connected);
    } catch (error) {
      console.error('Failed to check OAuth status:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleConnect = () => {
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const redirectUri = `${window.location.origin}/api/twitch/oauth/callback`;
    const scope = 'clips:edit';
    const state = serverId;

    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
    
    window.location.href = authUrl;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-3">
          {isConnected ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          Twitch OAuth
        </CardTitle>
        <CardDescription>
          {isConnected 
            ? 'Connected - Clip downloads enabled' 
            : 'Connect to enable clip video downloads'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert>
          <AlertDescription>
            OAuth authentication is required to download clip videos from Twitch CDN for GIF conversion.
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter>
        <Button 
          className="w-full" 
          onClick={handleConnect}
          disabled={isChecking || isConnected}
          variant={isConnected ? 'outline' : 'default'}
        >
          {isChecking ? 'Checking...' : isConnected ? 'Connected' : 'Connect Twitch'}
        </Button>
      </CardFooter>
    </Card>
  );
}
