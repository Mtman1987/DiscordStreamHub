'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function TwitchBotLinkingCard({ serverId }: { serverId: string }) {
  const handleLinkBot = () => {
    const scopes = ['chat:read', 'chat:edit', 'channel:read:subscriptions', 'bits:read'].join(' ');
    const redirectUri = `${window.location.origin}/api/twitch/bot-oauth/callback`;
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${serverId}&force_verify=true`;
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
        <Button onClick={handleLinkBot}>
          Link Bot Account
        </Button>
      </CardContent>
    </Card>
  );
}
