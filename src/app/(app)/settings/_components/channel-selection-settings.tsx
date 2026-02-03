'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Hash, Send, Calendar, Users, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getChannels } from '@/lib/discord-sync-service';

export function ChannelSelectionSettings() {
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [channels, setChannels] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [channelSettings, setChannelSettings] = React.useState({
    calendar: '',
    vipShoutouts: '',
    mountaineerShoutouts: '',
    trainShoutouts: '',
    pileShoutouts: '',
  });
  const { toast } = useToast();

  React.useEffect(() => {
    const id = localStorage.getItem('discordServerId');
    setServerId(id);
    if (id) {
      loadChannels(id);
      loadChannelSettings(id);
    }
  }, []);

  const loadChannels = async (id: string) => {
    try {
      const channelData = await getChannels(id);
      setChannels(channelData);
    } catch (error) {
      console.error('Error loading channels:', error);
    }
  };

  const loadChannelSettings = async (id: string) => {
    try {
      const response = await fetch(`/api/settings/channels?serverId=${id}`);
      if (response.ok) {
        const settings = await response.json();
        setChannelSettings(prev => ({ ...prev, ...settings }));
      }
    } catch (error) {
      console.error('Error loading channel settings:', error);
    }
  };

  const saveChannelSettings = async () => {
    if (!serverId) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/settings/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, channelSettings }),
      });
      
      if (!response.ok) throw new Error('Failed to save');
      
      toast({
        title: 'Success',
        description: 'Channel settings saved successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save channel settings',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testCalendarPost = async () => {
    if (!serverId || !channelSettings.calendar) {
      toast({
        title: 'Error',
        description: 'Please select a calendar channel first',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/calendar/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId,
          channelId: channelSettings.calendar,
        }),
      });

      if (!response.ok) throw new Error('Failed to post calendar');

      toast({
        title: 'Success',
        description: 'Calendar posted to Discord successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to post calendar',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Channel Configuration
          </CardTitle>
          <CardDescription>
            Configure which channels to use for different types of posts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Calendar Posts</Label>
              <Select 
                value={channelSettings.calendar} 
                onValueChange={(value) => setChannelSettings(prev => ({ ...prev, calendar: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
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

            <div className="space-y-2">
              <Label>VIP Shoutouts</Label>
              <Select 
                value={channelSettings.vipShoutouts} 
                onValueChange={(value) => setChannelSettings(prev => ({ ...prev, vipShoutouts: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
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

            <div className="space-y-2">
              <Label>Mountaineer Shoutouts</Label>
              <Select 
                value={channelSettings.mountaineerShoutouts} 
                onValueChange={(value) => setChannelSettings(prev => ({ ...prev, mountaineerShoutouts: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
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

            <div className="space-y-2">
              <Label>Train Shoutouts</Label>
              <Select 
                value={channelSettings.trainShoutouts} 
                onValueChange={(value) => setChannelSettings(prev => ({ ...prev, trainShoutouts: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
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

            <div className="space-y-2">
              <Label>Pile Shoutouts</Label>
              <Select 
                value={channelSettings.pileShoutouts} 
                onValueChange={(value) => setChannelSettings(prev => ({ ...prev, pileShoutouts: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
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
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={saveChannelSettings} disabled={isLoading}>
              <Send className="h-4 w-4 mr-2" />
              Save Settings
            </Button>
            
            <Button 
              variant="outline" 
              onClick={testCalendarPost} 
              disabled={isLoading || !channelSettings.calendar}
            >
              <Calendar className="h-4 w-4 mr-2" />
              Test Calendar Post
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}