'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRuntimeConfigClient } from '@/lib/runtime-config-client';

export function TwitchBotLinkingCard({ serverId }: { serverId: string }) {
  const [clientId, setClientId] = React.useState('');

  React.useEffect(() => {
    getRuntimeConfigClient().then((config) => {
      setClientId(config?.publicIds?.twitchClientId || '');
    }).catch(() => setClientId(''));
  }, []);

  const handleLinkBot = () => {
    const scopes = ['chat:read', 'chat:edit', 'channel:read:subscriptions', 'bits:read'].join(' ');
    const redirectUri = `${window.location.origin}/api/twitch/bot-oauth/callback`;
    if (!clientId) {
      console.warn('Twitch bot client ID is not loaded yet.');
      return;
    }
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${serverId}&force_verify=true`;
    window.location.href = authUrl;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Twitch Bot Account</CardTitle>
        <CardDescription>
          Link a Twitch bot account to monitor chat and award points
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleLinkBot} disabled={!clientId}>
          Link Bot Account
        </Button>
      </CardContent>
    </Card>
  );
}
