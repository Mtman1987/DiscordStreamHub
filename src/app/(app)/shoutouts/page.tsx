'use client';

import * as React from 'react';
import { useFirestore } from '@/firebase';
import { collection, query, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { Loader2, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ActiveShoutout {
  discordUserId: string;
  username: string;
  twitchLogin: string;
  messageId: string;
  channelId: string;
  isLive: boolean;
}

export default function ShoutoutsPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [shoutouts, setShoutouts] = React.useState<ActiveShoutout[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [deletingIds, setDeletingIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const storedServerId = localStorage.getItem('discordServerId');
    if (storedServerId) setServerId(storedServerId);
  }, []);

  const loadShoutouts = React.useCallback(async () => {
    if (!firestore || !serverId) return;
    
    setIsLoading(true);
    try {
      const usersRef = collection(firestore, 'servers', serverId, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      const activeShoutouts: ActiveShoutout[] = [];
      
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const shoutoutStateRef = doc(firestore, 'servers', serverId, 'users', userDoc.id, 'shoutoutState', 'current');
        const shoutoutStateSnap = await getDocs(query(collection(firestore, 'servers', serverId, 'users', userDoc.id, 'shoutoutState')));
        
        if (!shoutoutStateSnap.empty) {
          const shoutoutData = shoutoutStateSnap.docs[0].data();
          activeShoutouts.push({
            discordUserId: userDoc.id,
            username: userData.username || 'Unknown',
            twitchLogin: userData.twitchLogin || 'Unknown',
            messageId: shoutoutData.messageId || '',
            channelId: shoutoutData.channelId || '',
            isLive: shoutoutData.isLive || false
          });
        }
      }
      
      setShoutouts(activeShoutouts);
    } catch (error) {
      console.error('Error loading shoutouts:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load shoutouts'
      });
    } finally {
      setIsLoading(false);
    }
  }, [firestore, serverId, toast]);

  React.useEffect(() => {
    if (serverId) {
      loadShoutouts();
    }
  }, [serverId, loadShoutouts]);

  const handleDeleteShoutout = async (discordUserId: string, twitchLogin: string) => {
    if (!firestore || !serverId) return;
    
    setDeletingIds(prev => new Set(prev).add(discordUserId));
    try {
      const shoutoutStateRef = doc(firestore, 'servers', serverId, 'users', discordUserId, 'shoutoutState', 'current');
      await deleteDoc(shoutoutStateRef);
      
      toast({
        title: 'Shoutout Cleared',
        description: `Cleared shoutout state for ${twitchLogin}`
      });
      
      await loadShoutouts();
    } catch (error) {
      console.error('Error deleting shoutout:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete shoutout'
      });
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(discordUserId);
        return next;
      });
    }
  };

  const handleClearAll = async () => {
    if (!firestore || !serverId) return;
    if (!confirm('Clear ALL active shoutouts? This will remove all shoutout states.')) return;
    
    setIsLoading(true);
    try {
      for (const shoutout of shoutouts) {
        const shoutoutStateRef = doc(firestore, 'servers', serverId, 'users', shoutout.discordUserId, 'shoutoutState', 'current');
        await deleteDoc(shoutoutStateRef);
      }
      
      toast({
        title: 'All Cleared',
        description: 'All shoutout states have been cleared'
      });
      
      await loadShoutouts();
    } catch (error) {
      console.error('Error clearing all:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to clear all shoutouts'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#040b1f] via-[#071235] to-[#040818] text-white">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <PageHeader
          title="Shoutout Management"
          description="View and manage active stream shoutouts"
        >
          <div className="flex gap-3">
            <Button onClick={loadShoutouts} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Refresh
            </Button>
            <Button onClick={handleClearAll} variant="destructive" disabled={isLoading || shoutouts.length === 0}>
              Clear All
            </Button>
          </div>
        </PageHeader>

        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader>
            <CardTitle>Active Shoutouts ({shoutouts.length})</CardTitle>
            <CardDescription className="text-blue-200">
              These users currently have active shoutout states. Delete to force a fresh post on next poll.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              {isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : shoutouts.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">No active shoutouts</p>
              ) : (
                <div className="space-y-2">
                  {shoutouts.map(shoutout => (
                    <div
                      key={shoutout.discordUserId}
                      className="flex items-center justify-between p-4 bg-secondary/50 rounded-lg"
                    >
                      <div className="flex-1">
                        <p className="font-semibold">{shoutout.username}</p>
                        <p className="text-sm text-muted-foreground">
                          Twitch: {shoutout.twitchLogin} • {shoutout.isLive ? '🟢 Live' : '🔴 Offline'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Message ID: {shoutout.messageId}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => handleDeleteShoutout(shoutout.discordUserId, shoutout.twitchLogin)}
                        disabled={deletingIds.has(shoutout.discordUserId)}
                      >
                        {deletingIds.has(shoutout.discordUserId) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
