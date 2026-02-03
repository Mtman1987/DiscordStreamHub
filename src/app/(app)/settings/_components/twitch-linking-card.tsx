'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Link } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function TwitchLinkingCard({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const [isDispatching, setIsDispatching] = React.useState(false);

  const handleDispatchEmbed = async () => {
    setIsDispatching(true);

    try {
      const channelId = prompt('Enter the Discord channel ID to send the embed to:');

      if (!channelId) {
        toast({
          title: "Channel Required",
          description: "Please enter a valid Discord channel ID.",
          variant: "destructive",
        });
        setIsDispatching(false);
        return;
      }

      const response = await fetch('/api/discord/dispatch-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, channelId })
      });

      if (response.ok) {
        toast({
          title: "Embed Dispatched",
          description: "The linking embed has been sent to Discord.",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Dispatch Failed",
          description: error.error || "Failed to dispatch embed.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to dispatch embed.",
        variant: "destructive",
      });
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link className="w-5 h-5" />
          Twitch Linking
        </CardTitle>
        <CardDescription>
          Dispatch a linking embed to Discord for members to connect their Twitch accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={handleDispatchEmbed}
          disabled={isDispatching}
        >
          {isDispatching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Dispatching...
            </>
          ) : (
            <>
              <Link className="mr-2 h-4 w-4" />
              Dispatch Linking Embed
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
