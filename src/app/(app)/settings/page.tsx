'use client';

import * as React from 'react';
import { useFirestore } from '@/firebase';
import { doc, getDoc, writeBatch, Timestamp, setDoc } from 'firebase/firestore';
import { useRouter, usePathname } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Zap, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { AdminRoleSettings } from './_components/admin-role-settings';
import { UISettingsCard } from './_components/ui-settings';
import { MemberProcessingCard } from './_components/member-processing-card';
import { TwitchLinkingCard } from './_components/twitch-linking-card';
import { TwitchOAuthCard } from './_components/twitch-oauth-card';
import { cn } from '@/lib/utils';




export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const firestore = useFirestore();

  const [guildId, setGuildId] = React.useState('');
  const [manualChannelId, setManualChannelId] = React.useState('');
  const [manualChannelName, setManualChannelName] = React.useState('');
  const [isAddingChannel, setIsAddingChannel] = React.useState(false);
  const [isPolling, setIsPolling] = React.useState(false);
  const [isTogglingPolling, setIsTogglingPolling] = React.useState(false);

  // State for Health Check
  type HeartbeatStatus = 'checking' | 'ok' | 'error';
  const [heartbeat, setHeartbeat] = React.useState<HeartbeatStatus>('checking');
  const [heartbeatError, setHeartbeatError] = React.useState<string | null>(null);

  // State for Sync
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState('');
  const [syncStatus, setSyncStatus] = React.useState<'idle' | 'success' | 'error'>('idle');

  React.useEffect(() => {
    const storedGuildId = localStorage.getItem('discordServerId');
    if (storedGuildId) {
      setGuildId(storedGuildId);
      
      // Check polling status
      fetch('/api/twitch/polling-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: storedGuildId })
      }).then(r => r.json()).then(data => {
        setIsPolling(data.isPolling || false);
      }).catch(() => {});
    } else {
      setHeartbeat('error');
      setHeartbeatError('No Server ID found in local storage.');
    }
  }, []);

  // CLIENT-SIDE Health Check
  React.useEffect(() => {
    if (!firestore || !guildId) return;

    const performClientHealthCheck = async () => {
      setHeartbeat('checking');
      setHeartbeatError(null);
      
      const healthCheckRef = doc(firestore, 'servers', guildId, 'config', 'healthCheck');

      try {
        const docSnap = await getDoc(healthCheckRef);
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        if (docSnap.exists() && docSnap.data().lastChecked.toDate() > oneDayAgo) {
            setHeartbeat('ok');
            return;
        }

        await setDoc(healthCheckRef, {
          lastChecked: Timestamp.now(),
          status: 'ok',
        }, { merge: true });

        setHeartbeat('ok');
      } catch (error) {
        setHeartbeat('error');
        const message = error instanceof Error ? error.message : 'An unknown database error occurred.';
        setHeartbeatError(message);
        console.error('Client-side health check failed:', error);
      }
    };
    
    performClientHealthCheck();
  }, [firestore, guildId]);

  const handleAddChannel = async () => {
    if (!firestore || !guildId || !manualChannelId || !manualChannelName) return;
    
    setIsAddingChannel(true);
    try {
      const channelsRef = doc(firestore, 'servers', guildId, 'config', 'channels');
      const docSnap = await getDoc(channelsRef);
      const currentChannels = docSnap.exists() ? docSnap.data().list || [] : [];
      
      const newChannel = { id: manualChannelId, name: manualChannelName };
      const updatedChannels = [...currentChannels, newChannel];
      
      await setDoc(channelsRef, { list: updatedChannels }, { merge: true });
      
      setManualChannelId('');
      setManualChannelName('');
      setSyncStatus('success');
      setSyncMessage(`Channel "${manualChannelName}" added successfully!`);
    } catch (error) {
      console.error('Failed to add channel:', error);
      setSyncStatus('error');
      setSyncMessage('Failed to add channel.');
    } finally {
      setIsAddingChannel(false);
    }
  };

  const handleTogglePolling = async () => {
    if (!guildId) return;
    
    setIsTogglingPolling(true);
    try {
      const endpoint = isPolling ? '/api/twitch/stop-polling' : '/api/twitch/start-polling';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: guildId })
      });
      
      if (!response.ok) throw new Error('Failed to toggle polling');
      
      setIsPolling(!isPolling);
      setSyncStatus('success');
      setSyncMessage(isPolling ? 'Polling stopped' : 'Polling started - checking for live streams every 10 minutes');
    } catch (error) {
      console.error('Failed to toggle polling:', error);
      setSyncStatus('error');
      setSyncMessage('Failed to toggle polling.');
    } finally {
      setIsTogglingPolling(false);
    }
  };

  const handleClearShoutouts = async () => {
    if (!guildId) return;
    if (!confirm('This will clear all shoutout states. Continue?')) return;
    
    setIsTogglingPolling(true);
    try {
      const response = await fetch('/api/twitch/clear-shoutouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: guildId })
      });
      
      if (!response.ok) throw new Error('Failed to clear shoutouts');
      
      setSyncStatus('success');
      setSyncMessage('All shoutout states cleared. Fresh shoutouts will be posted on next poll.');
    } catch (error) {
      console.error('Failed to clear shoutouts:', error);
      setSyncStatus('error');
      setSyncMessage('Failed to clear shoutouts.');
    } finally {
      setIsTogglingPolling(false);
    }
  };

  const handleClientSideSync = async () => {
    if (!guildId) {
      setSyncStatus('error');
      setSyncMessage('Guild ID is required.');
      return;
    }

    setIsSyncing(true);
    setSyncStatus('idle');
    setSyncMessage('Starting sync...');

    try {
      setSyncMessage('Fetching data from Discord...');
      const response = await fetch('/api/discord/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch data from Discord.');
      }
      const data = await response.json();
      setSyncMessage('Writing to database...');

      if (!firestore) throw new Error('Firestore is not initialized.');

      const batch = writeBatch(firestore);

      const publicDiscordRef = doc(firestore, 'discords', data.server.serverId);
      batch.set(publicDiscordRef, data.server, { merge: true });

      const serverRef = doc(firestore, 'servers', data.server.serverId);
      batch.set(serverRef, data.server, { merge: true });
      
      const rolesRef = doc(serverRef, 'config', 'roles');
      const roleNames = data.roles.map((r: any) => r.name).filter((name: string) => name !== '@everyone');
      batch.set(rolesRef, { list: roleNames });

      const channelsRef = doc(serverRef, 'config', 'channels');
      const textChannels = data.channels
        .filter((c: any) => c.type === 0)
        .map((c: any) => ({ id: c.id, name: c.name }));
      batch.set(channelsRef, { list: textChannels });

      for (const member of data.members) {
        if (member.user.bot) continue;
        const userRef = doc(serverRef, 'users', member.user.id);
        const userRoles = member.roles.map((roleId: string) => data.roles.find((r: any) => r.id === roleId)?.name).filter(Boolean);
        batch.set(userRef, {
          discordUserId: member.user.id,
          username: member.user.username,
          avatarUrl: member.user.avatar ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(member.user.discriminator) % 5}.png`,
          roles: userRoles,
          group: 'Community',
          isOnline: false,
          topic: ''
        }, { merge: true });
      }

      await batch.commit();

      setSyncStatus('success');
      setSyncMessage(`Sync complete! Wrote ${data.members.length} members, ${data.roles.length} roles, and ${textChannels.length} channels.`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setSyncStatus('error');
      setSyncMessage(message);
      console.error('Client-side sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  };


  const handleReset = () => {
    localStorage.clear();
    router.push('/login');
  };
  
  const getHeartbeatDescription = () => {
    switch (heartbeat) {
        case 'ok':
            return "Database connection is healthy. Ready to sync.";
        case 'error':
            return heartbeatError || "Database connection failed. Check server logs.";
        case 'checking':
            return "Checking database connection...";
        default:
            return "Configure your server to check the database connection.";
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Configure your application and integrations."
      />
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-3">
                    <span
                        className={cn(
                        'h-3 w-3 rounded-full',
                        {
                            'bg-green-500': heartbeat === 'ok',
                            'bg-red-500': heartbeat === 'error',
                            'bg-yellow-500 animate-pulse': heartbeat === 'checking',
                        }
                        )}
                    />
                    Database Sync
                    </CardTitle>
                    <CardDescription className={cn(heartbeat === 'error' && 'text-destructive')}>
                        {getHeartbeatDescription()}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <Label htmlFor="sync-guild-id">Guild (Server) ID</Label>
                        <Input id="sync-guild-id" name="guildId" value={guildId} onChange={(e) => setGuildId(e.target.value)} required />
                    </div>
                    {syncStatus !== 'idle' && (
                        <Alert variant={syncStatus === 'error' ? 'destructive' : 'default'} className="mt-4">
                        <AlertTitle>{syncStatus === 'success' ? 'Success!' : 'Error'}</AlertTitle>
                        <AlertDescription>{syncMessage}</AlertDescription>
                        </Alert>
                    )}
                </CardContent>
                <CardFooter>
                    <Button className="w-full" onClick={handleClientSideSync} disabled={isSyncing || heartbeat !== 'ok'}>
                        {isSyncing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                        <Zap className="mr-2 h-4 w-4" />
                        )}
                        Sync with Discord
                    </Button>
                </CardFooter>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-3">
                    <span
                        className={cn(
                        'h-3 w-3 rounded-full',
                        {
                            'bg-green-500': isPolling,
                            'bg-gray-400': !isPolling,
                        }
                        )}
                    />
                    Twitch Polling
                    </CardTitle>
                    <CardDescription>
                        {isPolling ? 'Automatically checking for live streams every 10 minutes' : 'Polling is currently stopped'}
                    </CardDescription>
                </CardHeader>
                <CardFooter className="flex gap-2">
                    <Button className="flex-1" onClick={handleTogglePolling} disabled={isTogglingPolling}>
                        {isTogglingPolling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isPolling ? 'Stop Polling' : 'Start Polling'}
                    </Button>
                    <Button variant="destructive" onClick={handleClearShoutouts} disabled={isTogglingPolling}>
                        Clear All Shoutouts
                    </Button>
                </CardFooter>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Add Channel Manually</CardTitle>
                    <CardDescription>Add a channel by ID if it's not showing in sync</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="channel-id">Channel ID</Label>
                        <Input id="channel-id" value={manualChannelId} onChange={(e) => setManualChannelId(e.target.value)} placeholder="1284140462864728147" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="channel-name">Channel Name</Label>
                        <Input id="channel-name" value={manualChannelName} onChange={(e) => setManualChannelName(e.target.value)} placeholder="partners-shoutouts" />
                    </div>
                </CardContent>
                <CardFooter>
                    <Button className="w-full" onClick={handleAddChannel} disabled={isAddingChannel || !manualChannelId || !manualChannelName}>
                        {isAddingChannel ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Add Channel
                    </Button>
                </CardFooter>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Test Banner</CardTitle>
                    <CardDescription>Preview commander banner</CardDescription>
                </CardHeader>
                <CardContent>
                    <img 
                        src="https://storage.googleapis.com/studio-9468926194-e03ac.firebasestorage.app/banners/mtman1987.gif" 
                        alt="Commander Banner" 
                        className="w-full rounded-lg"
                    />
                </CardContent>
            </Card>
          {guildId && <AdminRoleSettings serverId={guildId} />}
        </div>
        

        <div className="space-y-8 lg:col-span-1">
            <UISettingsCard />
        </div>
        
        <div className="space-y-8 lg:col-span-1">
          {guildId && (
            <>
              <MemberProcessingCard serverId={guildId} />
              <TwitchLinkingCard serverId={guildId} />
              <TwitchOAuthCard serverId={guildId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
