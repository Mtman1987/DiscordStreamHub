'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Link, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function TwitchLinkForm() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const serverId = searchParams.get('serverId');

  const [twitchUsername, setTwitchUsername] = React.useState('');
  const [isLinking, setIsLinking] = React.useState(false);
  const [linkResult, setLinkResult] = React.useState<{ success: boolean; message: string } | null>(null);

  const handleLinkAccount = async () => {
    if (!twitchUsername.trim() || !serverId) return;

    setIsLinking(true);
    setLinkResult(null);

    try {
      const discordUserId = searchParams.get('userId') || localStorage.getItem('discordUserId');

      if (!discordUserId) {
        setLinkResult({
          success: false,
          message: 'Unable to identify your Discord account. Please try again from Discord.'
        });
        return;
      }

      const response = await fetch('/api/discord/link-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId,
          discordUserId,
          twitchLogin: twitchUsername.trim().toLowerCase()
        })
      });

      const result = await response.json();

      if (response.ok) {
        setLinkResult({
          success: true,
          message: `Successfully linked your Twitch account! You'll now receive shoutouts when you go live.`
        });

        toast({
          title: "Account Linked!",
          description: "Your Twitch account has been successfully linked.",
        });

        setTwitchUsername('');

      } else {
        setLinkResult({
          success: false,
          message: result.error || 'Failed to link account. Please check your Twitch username and try again.'
        });
      }

    } catch (error) {
      setLinkResult({
        success: false,
        message: 'An error occurred while linking your account. Please try again.'
      });
    } finally {
      setIsLinking(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLinking) {
      handleLinkAccount();
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
          <Link className="w-8 h-8 text-purple-600" />
        </div>
        <CardTitle className="text-2xl font-bold text-gray-900">
          Link Your Twitch Account
        </CardTitle>
        <CardDescription className="text-gray-600">
          Connect your Twitch account to get automatic shoutouts when you go live!
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="twitch-username">Twitch Username</Label>
          <Input
            id="twitch-username"
            type="text"
            placeholder="Enter your Twitch username"
            value={twitchUsername}
            onChange={(e) => setTwitchUsername(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLinking}
            className="text-center"
          />
        </div>

        <Button
          onClick={handleLinkAccount}
          disabled={!twitchUsername.trim() || isLinking || !serverId}
          className="w-full bg-purple-600 hover:bg-purple-700"
        >
          {isLinking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Linking Account...
            </>
          ) : (
            <>
              <Link className="mr-2 h-4 w-4" />
              Link Twitch Account
            </>
          )}
        </Button>

        {linkResult && (
          <Alert variant={linkResult.success ? "default" : "destructive"}>
            {linkResult.success ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            <AlertTitle>
              {linkResult.success ? "Success!" : "Error"}
            </AlertTitle>
            <AlertDescription>
              {linkResult.message}
            </AlertDescription>
          </Alert>
        )}

        <div className="text-center space-y-2">
          <p className="text-sm text-gray-500">
            By linking your account, you'll receive shoutouts in Discord when you start streaming.
          </p>
          <p className="text-xs text-gray-400">
            Make sure your Twitch username is spelled correctly.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function TwitchLinkEmbed() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-4">
      <Suspense fallback={<div>Loading...</div>}>
        <TwitchLinkForm />
      </Suspense>
    </div>
  );
}
