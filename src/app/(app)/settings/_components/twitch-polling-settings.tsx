'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RefreshCw, Play, Square, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDoc, useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';

export function TwitchPollingSettings() {
  const [isPolling, setIsPolling] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [serverId, setServerId] = React.useState<string | null>(null);
  const { toast } = useToast();

  React.useEffect(() => {
    const id = localStorage.getItem('discordServerId');
    setServerId(id);
  }, []);

  const firestore = useFirestore();
  const serverRef = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId);
  }, [firestore, serverId]);
  
  const { data: serverData } = useDoc<{ pollingEnabled?: boolean }>(serverRef);
  
  React.useEffect(() => {
    if (serverData?.pollingEnabled !== undefined) {
      setIsPolling(serverData.pollingEnabled);
    }
  }, [serverData]);

  const handlePollingToggle = async (enabled: boolean) => {
    if (!serverId) {
      toast({
        title: 'Error',
        description: 'No server ID found. Please ensure you are logged in.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/polling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: enabled ? 'start' : 'stop',
          serverId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to toggle polling');
      }

      setIsPolling(enabled);
      toast({
        title: 'Success',
        description: `Twitch polling ${enabled ? 'started' : 'stopped'} successfully`,
      });
    } catch (error) {
      console.error('Error toggling polling:', error);
      toast({
        title: 'Error',
        description: 'Failed to toggle polling service',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualPoll = async () => {
    if (!serverId) {
      toast({
        title: 'Error',
        description: 'No server ID found. Please ensure you are logged in.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/polling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'manual',
          serverId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to trigger manual poll');
      }

      toast({
        title: 'Success',
        description: 'Manual poll completed successfully',
      });
    } catch (error) {
      console.error('Error triggering manual poll:', error);
      toast({
        title: 'Error',
        description: 'Failed to trigger manual poll',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Twitch Polling Service
            </CardTitle>
            <CardDescription>
              Automatically monitor Twitch streams and update shoutout data
            </CardDescription>
          </div>
          <Badge variant={isPolling ? 'default' : 'secondary'}>
            {isPolling ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="polling-toggle">Enable Automatic Polling</Label>
            <p className="text-sm text-muted-foreground">
              Polls Twitch API every 5 minutes to update stream status and cache GIFs
            </p>
          </div>
          <Switch
            id="polling-toggle"
            checked={isPolling}
            onCheckedChange={handlePollingToggle}
            disabled={isLoading || !serverId}
          />
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium">Manual Actions</h4>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualPoll}
              disabled={isLoading || !serverId}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Poll Now
            </Button>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            <strong>Cloud Setup:</strong> For automatic polling, visit your deployed app at <code>/api/auto-poll</code> every 5 minutes using any cron service.
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium">What This Service Does</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Monitors online/offline status of all community members</li>
            <li>• Fetches recent Twitch clips for VIP shoutouts</li>
            <li>• Converts clips to GIFs for embedded shoutouts</li>
            <li>• Updates community spotlight with random clips</li>
            <li>• Caches data to improve shoutout generation speed</li>
          </ul>
        </div>

        {!serverId && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Please ensure you are logged in to use the polling service.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}