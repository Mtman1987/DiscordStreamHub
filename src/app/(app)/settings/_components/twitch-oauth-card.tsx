'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'next/navigation';

interface TwitchOAuthCardProps {
  serverId: string;
}

export function TwitchOAuthCard({ serverId }: TwitchOAuthCardProps) {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [isConnected, setIsConnected] = React.useState(false);
  const [userInfo, setUserInfo] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const reportedSearchState = React.useRef<string | null>(null);

  const checkOAuthStatus = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/twitch/oauth/status?serverId=${encodeURIComponent(serverId)}`);
      if (response.ok) {
        const data = await response.json();
        setIsConnected(data.connected);
        setUserInfo(data.user);
      } else {
        setIsConnected(false);
        setUserInfo(null);
      }
    } catch (error) {
      console.error('Failed to check bot status:', error);
      setIsConnected(false);
      setUserInfo(null);
    }
  }, [serverId]);

  React.useEffect(() => {
    checkOAuthStatus();
  }, [checkOAuthStatus]);

  React.useEffect(() => {
    setIsLoading(false);
  }, [searchParams]);

  React.useEffect(() => {
    const oauth = searchParams.get('oauth');
    const provider = searchParams.get('provider');
    const error = searchParams.get('error');
    const description = searchParams.get('error_description');
    const signature = `${oauth || ''}|${provider || ''}|${error || ''}|${description || ''}`;

    if (!oauth && !error) return;
    if (reportedSearchState.current === signature) return;
    reportedSearchState.current = signature;

    if (oauth === 'success' && (!provider || provider === 'twitch')) {
      toast({
        title: 'Connected',
        description: 'Twitch bot OAuth connected successfully.',
      });
      setTimeout(checkOAuthStatus, 250);
      return;
    }

    if (error) {
      toast({
        title: 'Twitch OAuth failed',
        description: description || error,
        variant: 'destructive',
      });
    }
  }, [checkOAuthStatus, searchParams, toast]);

  const handleTwitchOAuth = () => {
    setIsLoading(true);
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/twitch/oauth/callback`);
    const scope = encodeURIComponent('chat:read chat:edit');

    if (!clientId) {
      setIsLoading(false);
      toast({
        title: 'Twitch OAuth unavailable',
        description: 'Missing Twitch client ID in the app configuration.',
        variant: 'destructive',
      });
      return;
    }
    
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${serverId}&force_verify=true`;
    window.location.href = authUrl;
  };

  const handleDisconnect = async () => {
    try {
      const response = await fetch('/api/twitch/oauth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });
      if (!response.ok) throw new Error('Disconnect request failed');
      setIsConnected(false);
      setUserInfo(null);
      toast({
        title: 'Disconnected',
        description: 'Twitch bot OAuth disconnected.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to disconnect.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="h-5 w-5 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.149 0L.537 4.119v16.845h5.373V24l4.298-2.985h3.582L22.388 12V0H2.149zm19.104 11.194l-3.582 3.582H14.18l-3.209 3.209v-3.209H5.91V1.493h15.343v9.701zM11.94 4.119h2.149v5.373h-2.149V4.119zm-5.373 0h2.149v5.373H6.567V4.119z"/>
          </svg>
          Twitch Bot OAuth for Hear Me Out
          {isConnected && <Badge variant="secondary" className="text-green-600">Connected</Badge>}
        </CardTitle>
        <CardDescription>
          Connect Twitch bot OAuth to share authentication with Hear Me Out song request features
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected && userInfo ? (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Connected as <strong>{userInfo.username}</strong>
              <br />
              <span className="text-xs text-muted-foreground">
                Tokens saved to shared SQLite for Hear Me Out access
              </span>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Twitch bot OAuth not connected. Hear Me Out song requests won't work.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {isConnected ? (
            <Button variant="outline" onClick={handleDisconnect}>
              Disconnect Bot
            </Button>
          ) : (
            <Button onClick={handleTwitchOAuth} disabled={isLoading}>
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Connect Twitch Bot OAuth
                </>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={checkOAuthStatus}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Identical to Discord OAuth - shared SQLite tokens</p>
          <p>• Required for song requests/chat integration in Hear Me Out</p>
        </div>
      </CardContent>
    </Card>
  );
}
