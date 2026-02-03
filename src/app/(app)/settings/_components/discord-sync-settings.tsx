'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Users, Hash, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getChannels, getRoles, getRoleMappings, updateRoleMappings } from '@/lib/discord-sync-service';

export function DiscordSyncSettings() {
  const [isLoading, setIsLoading] = React.useState(false);
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [channels, setChannels] = React.useState<any[]>([]);
  const [roles, setRoles] = React.useState<string[]>([]);
  const [channelMappings, setChannelMappings] = React.useState({
    vip: '',
    community: '',
    train: '',
    pile: '',
  });
  const [roleMappings, setRoleMappings] = React.useState<Record<string, string>>({});
  const { toast } = useToast();

  React.useEffect(() => {
    const id = localStorage.getItem('discordServerId');
    setServerId(id);
    if (id) {
      loadServerData(id);
    }
  }, []);

  const loadServerData = async (id: string) => {
    try {
      const [channelData, roleData, mappingData] = await Promise.all([
        getChannels(id),
        getRoles(id),
        getRoleMappings(id),
      ]);
      setChannels(channelData);
      setRoles(roleData);
      setRoleMappings(mappingData);
    } catch (error) {
      console.error('Error loading server data:', error);
    }
  };

  const handleRoleMappingChange = (roleId: string, group: string) => {
    setRoleMappings(prev => ({
      ...prev,
      [roleId]: group === 'none' ? undefined : group
    }));
  };

  const saveRoleMappings = async () => {
    if (!serverId) return;
    
    setIsLoading(true);
    try {
      await updateRoleMappings(serverId, roleMappings);
      toast({
        title: 'Success',
        description: 'Role mappings saved successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save role mappings',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    if (!serverId) {
      toast({
        title: 'Error',
        description: 'No server ID found',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/discord/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });

      if (!response.ok) throw new Error('Sync failed');

      await loadServerData(serverId);
      toast({
        title: 'Success',
        description: 'Discord data synced successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to sync Discord data',
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Discord Integration
              </CardTitle>
              <CardDescription>
                Sync server members, channels, and roles
              </CardDescription>
            </div>
            <Button onClick={handleSync} disabled={isLoading || !serverId}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Sync Discord
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{channels.length}</div>
              <div className="text-sm text-muted-foreground">Channels</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{roles.length}</div>
              <div className="text-sm text-muted-foreground">Roles</div>
            </div>
            <div>
              <div className="text-2xl font-bold">-</div>
              <div className="text-sm text-muted-foreground">Members</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Shoutout Channels
          </CardTitle>
          <CardDescription>
            Configure which channels to send shoutouts to for each group
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>VIP Shoutouts</Label>
              <Select value={channelMappings.vip} onValueChange={(value) => 
                setChannelMappings(prev => ({ ...prev, vip: value }))
              }>
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
              <Label>Community Shoutouts</Label>
              <Select value={channelMappings.community} onValueChange={(value) => 
                setChannelMappings(prev => ({ ...prev, community: value }))
              }>
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
              <Label>Train</Label>
              <Select value={channelMappings.train} onValueChange={(value) => 
                setChannelMappings(prev => ({ ...prev, train: value }))
              }>
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
              <Label>Pile</Label>
              <Select value={channelMappings.pile} onValueChange={(value) => 
                setChannelMappings(prev => ({ ...prev, pile: value }))
              }>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Role Mappings
          </CardTitle>
          <CardDescription>
            Map Discord roles to Space Mountain groups
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {roles.map((roleName, index) => (
              <div key={roleName} className="flex items-center justify-between">
                <Badge variant="outline">
                  {roleName}
                </Badge>
                <Select 
                  value={roleMappings[roleName] || 'none'} 
                  onValueChange={(value) => handleRoleMappingChange(roleName, value)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="VIP">VIP</SelectItem>
                    <SelectItem value="Community">Community</SelectItem>
                    <SelectItem value="Train">Train</SelectItem>
                    <SelectItem value="Pile">Pile</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Button onClick={saveRoleMappings} disabled={isLoading}>
              Save Role Mappings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}