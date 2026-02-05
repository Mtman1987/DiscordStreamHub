'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface TwitchOAuthCardProps {
  serverId: string;
}

export function TwitchOAuthCard({ serverId }: TwitchOAuthCardProps) {
  const handleConnectUser = () => {
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const redirectUri = `${window.location.origin}/api/twitch/oauth/callback`;
    const scope = 'clips:edit';
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${serverId}&force_verify=true`;
    window.location.href = authUrl;
  };

  const handleConnectBot = () => {
    const scopes = ['chat:read', 'chat:edit', 'channel:read:subscriptions', 'bits:read'].join(' ');
    const redirectUri = `${window.location.origin}/api/twitch/bot-oauth/callback`;
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${serverId}&force_verify=true`;
    window.location.href = authUrl;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Twitch OAuth</CardTitle>
        <CardDescription>
          Connect Twitch accounts for admin features and chat monitoring
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            User account enables clip downloads. Bot account enables chat monitoring and points.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button onClick={handleConnectUser} className="flex-1">
            Connect User Account
          </Button>
          <Button onClick={handleConnectBot} className="flex-1" variant="secondary">
            Connect Bot Account
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
