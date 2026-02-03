'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Link } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getChannels } from '@/lib/discord-sync-service';

export function TwitchLinkingCard({ serverId }: { serverId: string }) {
  const { toast } = useToast();
  const [isDispatching, setIsDispatching] = React.useState(false);
  const [channels, setChannels] = React.useState<any[]>([]);
  const [selectedChannel, setSelectedChannel] = React.useState('');

  React.useEffect(() => {
    if (serverId) {
      loadChannels();
    }
  }, [serverId]);

  const loadChannels = async () => {
    try {
      const channelData = await getChannels(serverId);
      setChannels(channelData);
    } catch (error) {
      console.error('Error loading channels:', error);
    }
  };

  const handleDispatchEmbed = async () => {
    if (!selectedChannel) {
      toast({
        title: "Channel Required",
        description: "Please select a Discord channel.",
        variant: "destructive",
      });
      return;
    }

    setIsDispatching(true);

    try {
      const response = await fetch('/api/discord/dispatch-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, channelId: selectedChannel })
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
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Select Channel</Label>
          <Select value={selectedChannel} onValueChange={setSelectedChannel}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a channel" />
            </SelectTrigger>
            <SelectContent>
              {channels.map(channel => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <Button
          onClick={handleDispatchEmbed}
          disabled={isDispatching || !selectedChannel}
          className="w-full"
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
