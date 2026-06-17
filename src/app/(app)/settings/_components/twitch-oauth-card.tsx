'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'next/navigation';
import { getRuntimeConfigClient } from '@/lib/runtime-config-client';

interface TwitchOAuthCardProps {
  serverId: string;
}

export function TwitchOAuthCard({ serverId }: TwitchOAuthCardProps) {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [isConnected, setIsConnected] = React.useState(false);
  const [needsReconnect, setNeedsReconnect] = React.useState(false);
  const [userInfo, setUserInfo] = React.useState<any>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [clientId, setClientId] = React.useState<string>('');
  const [appUrl, setAppUrl] = React.useState<string>('');
  const reportedSearchState = React.useRef<string | null>(null);

  const checkOAuthStatus = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/twitch/oauth/status?serverId=${encodeURIComponent(serverId)}`);
      if (response.ok) {
        const data = await response.json();
        setIsConnected(data.connected);
        setNeedsReconnect(Boolean(data.needsReconnect));
        setUserInfo(data.user);
        setLastError(typeof data.lastError === 'string' ? data.lastError : null);
      } else {
        setIsConnected(false);
        setNeedsReconnect(false);
        setUserInfo(null);
        setLastError(null);
      }
    } catch (error) {
      console.error('Failed to check bot status:', error);
      setIsConnected(false);
      setNeedsReconnect(false);
      setUserInfo(null);
      setLastError(null);
    }
  }, [serverId]);

  React.useEffect(() => {
    checkOAuthStatus();
  }, [checkOAuthStatus]);

  React.useEffect(() => {
    getRuntimeConfigClient().then((config) => {
      setClientId(config?.publicIds?.twitchClientId || '');
      setAppUrl(config?.publicUrls?.appUrl || '');
    }).catch(() => setClientId(''));
  }, []);

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
    const redirectBase = (appUrl || window.location.origin).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${redirectBase}/api/twitch/oauth/callback`);
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
    
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${encodeURIComponent(`bot|${serverId}`)}&force_verify=true`;
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
      setNeedsReconnect(false);
      setUserInfo(null);
      setLastError(null);
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
          DSH Twitch Chat Bot OAuth
          {isConnected && <Badge variant="secondary" className="text-green-600">Connected</Badge>}
          {needsReconnect && <Badge variant="destructive">Reconnect Required</Badge>}
        </CardTitle>
        <CardDescription>
          Reauthorize the Twitch bot token used by DSH chat monitoring. This token may also be shared with Hear Me Out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {needsReconnect ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The saved Twitch bot refresh token is no longer valid. Reconnect this bot token to stop the refresh errors.
            </AlertDescription>
          </Alert>
        ) : isConnected && userInfo ? (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Connected as <strong>{userInfo.username}</strong>
              <br />
              <span className="text-xs text-muted-foreground">
                Used by DSH Twitch chat monitoring and any shared chat-side integrations
              </span>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Twitch bot OAuth is not connected. DSH Twitch chat monitoring will stay offline until you reconnect it.
            </AlertDescription>
          </Alert>
        )}

        {lastError && needsReconnect ? (
          <div className="text-xs text-muted-foreground break-words">
            Last refresh error: {lastError}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button onClick={handleTwitchOAuth} disabled={isLoading || !clientId}>
            {isLoading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4 mr-2" />
                {isConnected && !needsReconnect ? 'Reconnect Twitch Bot' : 'Connect Twitch Bot'}
              </>
            )}
          </Button>
          {(isConnected || needsReconnect) ? (
            <Button variant="outline" onClick={handleDisconnect}>
              Disconnect Bot
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={checkOAuthStatus}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• This is the bot token that produces the repeated Twitch refresh errors when it goes stale</p>
          <p>• Reconnecting here replaces the invalid refresh token and clears the retry backoff</p>
        </div>
      </CardContent>
    </Card>
  );
}
