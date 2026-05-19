'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Users, Hash, Shield, Pencil, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateRoleMappings } from '@/lib/discord-sync-service';
import { useDbDoc, dbUpdate, dbGet } from '@/hooks/use-db';

interface RoleInfo { id: string; name: string; }

export function DiscordSyncSettings({ serverId: propServerId }: { serverId?: string }) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [serverId, setServerId] = React.useState<string | null>(propServerId || null);
  const [channels, setChannels] = React.useState<any[]>([]);
  const [roles, setRoles] = React.useState<RoleInfo[]>([]);
  const [channelMappings, setChannelMappings] = React.useState({ 'Crew': '', 'Partners': '', 'Honored Guests': '', 'Raid Pile': '', 'Everyone Else': '' });
  const [roleMappings, setRoleMappings] = React.useState<Record<string, string>>({});
  const [manualMode, setManualMode] = React.useState<Record<string, boolean>>({});
  const [nukeChannel, setNukeChannel] = React.useState('');
  const [isNuking, setIsNuking] = React.useState(false);
  const [nukeLog, setNukeLog] = React.useState<string[]>([]);
  const [nukeMode, setNukeMode] = React.useState<'bot' | 'all' | 'until'>('bot');
  const [nukeUntilId, setNukeUntilId] = React.useState('');
  const { toast } = useToast();

  const { data: groupChannelsData } = useDbDoc<Record<string, string>>(serverId ? `servers/${serverId}/config/groupChannels` : null);
  const { data: serverData } = useDbDoc<Record<string, any>>(serverId ? `servers/${serverId}` : null);
  const { data: rolesData } = useDbDoc<{ list: any[]; detailed?: RoleInfo[] }>(serverId ? `servers/${serverId}/config/roles` : null);
  const { data: channelsData } = useDbDoc<{ list: any[] }>(serverId ? `servers/${serverId}/config/channels` : null);

  React.useEffect(() => {
    if (channelsData?.list) setChannels(channelsData.list);
  }, [channelsData]);

  React.useEffect(() => {
    const id = propServerId || localStorage.getItem('discordServerId');
    setServerId(id);
  }, [propServerId]);

  React.useEffect(() => {
    if (groupChannelsData) {
      setChannelMappings({
        'Crew': groupChannelsData['Crew'] || '', 'Partners': groupChannelsData['Partners'] || '',
        'Honored Guests': groupChannelsData['Honored Guests'] || '', 'Raid Pile': groupChannelsData['Raid Pile'] || '',
        'Everyone Else': groupChannelsData['Everyone Else'] || '',
      });
    }
  }, [groupChannelsData]);

  React.useEffect(() => {
    if (serverData?.roleMappings && roles.length > 0) setRoleMappings(serverData.roleMappings);
  }, [serverData, roles]);

  React.useEffect(() => {
    if (rolesData?.detailed?.length) setRoles(rolesData.detailed);
    else if (rolesData?.list?.length) {
      if (typeof rolesData.list[0] === 'object' && rolesData.list[0].id) setRoles(rolesData.list.map((r: any) => ({ id: r.id, name: r.name })));
      else setRoles(rolesData.list.map((name: any) => ({ id: String(name), name: String(name) })));
    }
  }, [rolesData]);

  const handleRoleMappingChange = (roleId: string, group: string) => {
    setRoleMappings(prev => { const next = { ...prev }; if (group === 'none') delete next[roleId]; else next[roleId] = group; return next; });
  };

  const saveRoleMappings = async () => {
    if (!serverId) return;
    setIsLoading(true);
    try { await updateRoleMappings(serverId, roleMappings); toast({ title: 'Success', description: 'Role mappings saved' }); }
    catch { toast({ title: 'Error', description: 'Failed to save role mappings', variant: 'destructive' }); }
    finally { setIsLoading(false); }
  };

  const saveChannelMappings = async () => {
    if (!serverId) return;
    setIsLoading(true);
    try {
      await dbUpdate(`servers/${serverId}/config/groupChannels`, { ...channelMappings, 'Community': channelMappings['Everyone Else'] });
      toast({ title: 'Success', description: 'Channel mappings saved' });
    } catch { toast({ title: 'Error', description: 'Failed to save channel mappings', variant: 'destructive' }); }
    finally { setIsLoading(false); }
  };

  const handleSync = async () => {
    if (!serverId) { toast({ title: 'Error', description: 'No server ID found', variant: 'destructive' }); return; }
    setIsLoading(true);
    try {
      const response = await fetch('/api/discord/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: serverId }) });
      if (!response.ok) throw new Error('Sync failed');
      const data = await response.json();
      setChannels(data.channels || []);
      toast({ title: 'Success', description: `Synced ${data.channels?.length || 0} channels, ${data.roles?.length || 0} roles.` });
      const chRes = await fetch(`/api/db?path=servers/${serverId}/config/channels`);
      const chJson = await chRes.json();
      if (chJson.data?.list) setChannels(chJson.data.list);
      const rolesRes = await fetch(`/api/db?path=servers/${serverId}/config/roles`);
      const rolesJson = await rolesRes.json();
      if (rolesJson.data?.detailed) setRoles(rolesJson.data.detailed);
    } catch { toast({ title: 'Error', description: 'Failed to sync Discord data', variant: 'destructive' }); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Discord Integration</CardTitle>
              <CardDescription>Sync server members, channels, and roles</CardDescription>
            </div>
            <Button onClick={handleSync} disabled={isLoading || !serverId}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />Sync Discord
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><div className="text-2xl font-bold">{channels.length}</div><div className="text-sm text-muted-foreground">Channels</div></div>
            <div><div className="text-2xl font-bold">{roles.length}</div><div className="text-sm text-muted-foreground">Roles</div></div>
            <div><div className="text-2xl font-bold">-</div><div className="text-sm text-muted-foreground">Members</div></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Hash className="h-5 w-5" />Shoutout Channels</CardTitle>
          <CardDescription>Configure which channels to send shoutouts to for each group</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {(['Crew', 'Partners', 'Honored Guests', 'Raid Pile', 'Everyone Else'] as const).map((group) => {
              const isManual = manualMode[group];
              return (
                <div key={group} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{group === 'Everyone Else' ? 'Community (Everyone Else)' : `${group} Shoutouts`}</Label>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setManualMode(prev => ({ ...prev, [group]: !prev[group] }))}><Pencil className="h-3 w-3" /></Button>
                  </div>
                  {isManual ? (
                    <Input placeholder="Paste channel ID" value={channelMappings[group]} onChange={(e) => setChannelMappings(prev => ({ ...prev, [group]: e.target.value }))} />
                  ) : (
                    <Select value={channelMappings[group]} onValueChange={(value) => setChannelMappings(prev => ({ ...prev, [group]: value }))}>
                      <SelectTrigger><SelectValue placeholder="Select channel" /></SelectTrigger>
                      <SelectContent>{channels.map(ch => <SelectItem key={ch.id} value={ch.id}>#{ch.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {channelMappings[group] && <p className="text-xs text-muted-foreground">ID: {channelMappings[group]}</p>}
                </div>
              );
            })}
          </div>
          <Button onClick={saveChannelMappings} disabled={isLoading}>Save Channel Mappings</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Role Mappings</CardTitle>
          <CardDescription>Map Discord roles to groups (priority: Crew &gt; Partners &gt; Honored Guests &gt; Raid Pile &gt; Everyone Else)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {roles.map((role) => (
              <div key={role.id} className="flex items-center justify-between">
                <Badge variant="outline">{role.name}</Badge>
                <Select value={roleMappings[role.id] || 'none'} onValueChange={(value) => handleRoleMappingChange(role.id, value)}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Group" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="Crew">Crew</SelectItem>
                    <SelectItem value="Partners">Partners</SelectItem>
                    <SelectItem value="Honored Guests">Honored Guests</SelectItem>
                    <SelectItem value="Raid Pile">Raid Pile</SelectItem>
                    <SelectItem value="Everyone Else">Everyone Else</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="mt-4"><Button onClick={saveRoleMappings} disabled={isLoading}>Save Role Mappings</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-500"><Trash2 className="h-5 w-5" />Nuke Channel</CardTitle>
          <CardDescription>Delete messages from a channel. Choose bot-only or all messages.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={nukeChannel} onValueChange={setNukeChannel}>
                <SelectTrigger><SelectValue placeholder="Choose a channel" /></SelectTrigger>
                <SelectContent>{channels.map(ch => <SelectItem key={ch.id} value={ch.id}>#{ch.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={nukeMode} onValueChange={(v) => setNukeMode(v as 'bot' | 'all' | 'until')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bot">Bot messages only</SelectItem>
                  <SelectItem value="all">⚠️ ALL messages</SelectItem>
                  <SelectItem value="until">🎯 Until message ID</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {nukeMode === 'all' && (
            <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              ⚠️ This will delete EVERY message in the channel — including messages from other bots and users.
            </div>
          )}
          {nukeMode === 'until' && (
            <div className="space-y-2">
              <div className="p-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
                🎯 Deletes ALL messages until it reaches the specified message ID. Right-click a message in Discord → Copy Message ID.
              </div>
              <Input placeholder="Message ID (e.g. 1287828531061198889)" value={nukeUntilId} onChange={(e) => setNukeUntilId(e.target.value)} />
            </div>
          )}
          <Button
            variant="destructive"
            onClick={async () => {
              if (!nukeChannel || !serverId) return;
              const channelName = channels.find(c => c.id === nukeChannel)?.name || nukeChannel;
              const modeLabel = nukeMode === 'all' ? 'ALL messages' : 'bot messages';
              if (!confirm(`Delete ${modeLabel} from #${channelName}? This cannot be undone.`)) return;
              setIsNuking(true);
              setNukeLog(['Starting cleanup...']);
              try {
                const res = await fetch('/api/nuke-channel', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ channelId: nukeChannel, mode: nukeMode, untilMessageId: nukeMode === 'until' ? nukeUntilId : undefined }),
                });
                const data = await res.json();
                if (data.success) {
                  setNukeLog(data.log || [`Deleted ${data.deleted} messages`]);
                  toast({ title: 'Channel cleaned!', description: `Deleted ${data.deleted} messages from #${channelName}` });
                } else {
                  setNukeLog([`Error: ${data.error}`]);
                  toast({ title: 'Error', description: data.error, variant: 'destructive' });
                }
              } catch (e) {
                setNukeLog([`Error: ${e}`]);
                toast({ title: 'Error', description: 'Failed to clean channel', variant: 'destructive' });
              } finally {
                setIsNuking(false);
              }
            }}
            disabled={isNuking || !nukeChannel || (nukeMode === 'until' && !nukeUntilId)}
          >
            {isNuking ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {isNuking ? 'Cleaning...' : nukeMode === 'all' ? 'Nuke Everything' : nukeMode === 'until' ? 'Delete Until ID' : 'Nuke Bot Messages'}
          </Button>
          {nukeLog.length > 0 && (
            <div className="bg-secondary/50 rounded-md p-3 text-xs font-mono max-h-40 overflow-y-auto">
              {nukeLog.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
