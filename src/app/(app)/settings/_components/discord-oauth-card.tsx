'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getRuntimeConfigClient } from '@/lib/runtime-config-client';

interface DiscordOAuthCardProps {
  serverId: string;
}

export function DiscordOAuthCard({ serverId }: DiscordOAuthCardProps) {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = React.useState(false);
  const [userInfo, setUserInfo] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [clientId, setClientId] = React.useState('');

  React.useEffect(() => {
    getRuntimeConfigClient().then((config) => {
      setClientId(config?.publicIds?.discordClientId || '');
    }).catch(() => setClientId(''));
  }, []);

  const checkOAuthStatus = React.useCallback(async () => {
    try {
      const userId = window.localStorage.getItem('discordUserId');
      const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      const response = await fetch(`/api/discord/oauth/status${query}`);
      if (response.ok) {
        const data = await response.json();
        setIsConnected(data.connected);
        setUserInfo(data.user);
      }
    } catch (error) {
      console.error('Failed to check OAuth status:', error);
    }
  }, []);

  React.useEffect(() => {
    checkOAuthStatus();
  }, [checkOAuthStatus]);

  const handleDiscordOAuth = () => {
    setIsLoading(true);
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/discord/oauth/callback`);
    const scope = encodeURIComponent('identify email guilds');
    if (!clientId) {
      setIsLoading(false);
      toast({
        title: 'Discord OAuth unavailable',
        description: 'Missing Discord client ID in the app configuration.',
        variant: 'destructive',
      });
      return;
    }
    
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=dsh-settings`;
    
    const popup = window.open(authUrl, 'discord-oauth', 'width=500,height=700');
    
    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        setIsLoading(false);
        setTimeout(checkOAuthStatus, 1000);
      }
    }, 1000);
  };

  const handleDisconnect = async () => {
    try {
      const userId = window.localStorage.getItem('discordUserId');
      const response = await fetch('/api/discord/oauth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      
      if (response.ok) {
        setIsConnected(false);
        setUserInfo(null);
        toast({
          title: 'Disconnected',
          description: 'Discord OAuth has been disconnected.',
        });
      } else {
        throw new Error('Disconnect request failed');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to disconnect Discord OAuth.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
          Discord OAuth for Hear Me Out
          {isConnected && <Badge variant="secondary" className="text-green-600">Connected</Badge>}
        </CardTitle>
        <CardDescription>
          Connect Discord OAuth to share authentication with Hear Me Out application
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected && userInfo ? (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Connected as <strong>{userInfo.username}#{userInfo.discriminator}</strong>
              <br />
              <span className="text-xs text-muted-foreground">
                Authentication tokens are saved to shared location for Hear Me Out access
              </span>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {"Discord OAuth is not connected. Hear Me Out won't be able to access Discord features."}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {isConnected ? (
            <Button variant="outline" onClick={handleDisconnect}>
              Disconnect Discord
            </Button>
          ) : (
            <Button onClick={handleDiscordOAuth} disabled={isLoading || !clientId}>
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Connect Discord OAuth
                </>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={checkOAuthStatus}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Status
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• This OAuth connection is shared between Discord Stream Hub and Hear Me Out</p>
          <p>• Tokens are stored in a shared location accessible by both applications</p>
          <p>• Required for Hear Me Out to access Discord server information</p>
        </div>
      </CardContent>
    </Card>
  );
}
