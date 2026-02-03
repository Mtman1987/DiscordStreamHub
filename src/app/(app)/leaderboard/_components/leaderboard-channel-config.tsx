'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Save, Trash2, Send } from 'lucide-react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';

interface LeaderboardChannelConfigProps {
  serverId: string;
}

export function LeaderboardChannelConfig({ serverId }: LeaderboardChannelConfigProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [channelId, setChannelId] = React.useState('');
  const [channelInput, setChannelInput] = React.useState('');
  const [isPosting, setIsPosting] = React.useState(false);

  React.useEffect(() => {
    if (!firestore || !serverId) return;
    
    const fetchChannel = async () => {
      try {
        const serverRef = doc(firestore, 'servers', serverId);
        const snapshot = await getDoc(serverRef);
        if (!snapshot.exists()) return;
        
        const storedChannels = snapshot.data()?.shoutoutChannels || {};
        const leaderboardChannel = storedChannels.leaderboard;
        
        if (typeof leaderboardChannel === 'string' && leaderboardChannel.trim().length > 0) {
          setChannelId(leaderboardChannel);
          setChannelInput(leaderboardChannel);
        }
      } catch (error) {
        console.error('Failed to load leaderboard channel from Firestore', error);
      }
    };
    
    fetchChannel();
  }, [firestore, serverId]);

  const handleChannelSave = React.useCallback(async () => {
    const trimmed = channelInput.trim();
    if (!trimmed) {
      toast({
        variant: 'destructive',
        title: 'Channel ID required',
        description: 'Enter a Discord channel ID before saving.',
      });
      return;
    }
    
    if (!serverId || !firestore) {
      toast({
        variant: 'destructive',
        title: 'Server not selected',
        description: 'Set your Discord server ID in Settings first.',
      });
      return;
    }

    try {
      const serverRef = doc(firestore, 'servers', serverId);
      const serverDoc = await getDoc(serverRef);
      const currentChannels = serverDoc.exists() ? serverDoc.data()?.shoutoutChannels || {} : {};
      
      await updateDoc(serverRef, {
        shoutoutChannels: {
          ...currentChannels,
          leaderboard: trimmed
        }
      });
      
      setChannelId(trimmed);
      toast({
        title: 'Leaderboard channel saved',
        description: `Leaderboard screenshots will be posted to channel ${trimmed}.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to save channel',
        description: 'Could not save the leaderboard channel configuration.',
      });
    }
  }, [channelInput, serverId, firestore, toast]);

  const handleChannelClear = React.useCallback(async () => {
    if (!serverId || !firestore) return;

    try {
      const serverRef = doc(firestore, 'servers', serverId);
      const serverDoc = await getDoc(serverRef);
      const currentChannels = serverDoc.exists() ? serverDoc.data()?.shoutoutChannels || {} : {};
      
      await updateDoc(serverRef, {
        shoutoutChannels: {
          ...currentChannels,
          leaderboard: ''
        }
      });
      
      setChannelId('');
      setChannelInput('');
      toast({
        title: 'Leaderboard channel cleared',
        description: 'Configure a new channel before posting leaderboard screenshots.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to clear channel',
        description: 'Could not clear the leaderboard channel configuration.',
      });
    }
  }, [serverId, firestore, toast]);

  const handlePostLeaderboard = React.useCallback(async () => {
    if (!channelId.trim()) {
      toast({
        variant: 'destructive',
        title: 'No channel configured',
        description: 'Configure a Discord channel before posting the leaderboard.',
      });
      return;
    }

    setIsPosting(true);
    try {
      const response = await fetch('/api/leaderboard/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });

      if (response.ok) {
        toast({
          title: 'Leaderboard posted!',
          description: 'The leaderboard screenshot has been posted to Discord.',
        });
      } else {
        throw new Error('Failed to generate leaderboard');
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to post leaderboard',
        description: 'Could not generate and post the leaderboard screenshot.',
      });
    } finally {
      setIsPosting(false);
    }
  }, [channelId, serverId, toast]);

  const activeChannelId = channelId.trim().length > 0 ? channelId.trim() : null;

  return (
    <div style={{
      backgroundColor: '#1a1a2e',
      border: '1px solid #333',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '32px'
    }}>
      <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 8px 0' }}>
        Leaderboard Channel Configuration
      </h2>
      <p style={{ color: '#888', margin: '0 0 24px 0', fontSize: '14px' }}>
        Configure where leaderboard screenshots should be posted in Discord.
      </p>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <Label htmlFor="leaderboard-channel" style={{ fontSize: '14px', fontWeight: '500' }}>
            Discord Channel ID
          </Label>
          <Input
            id="leaderboard-channel"
            placeholder="e.g. 123456789012345678"
            value={channelInput}
            onChange={(event) => setChannelInput(event.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button type="button" onClick={handleChannelSave}>
            <Save className="mr-2 h-4 w-4" />
            Save Channel
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleChannelClear}
            disabled={!channelId}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Clear
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handlePostLeaderboard}
            disabled={!activeChannelId || isPosting}
          >
            <Send className="mr-2 h-4 w-4" />
            {isPosting ? 'Posting...' : 'Post Leaderboard'}
          </Button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#888' }}>
          <span>Leaderboard screenshots will be posted to this channel.</span>
          <Badge variant={activeChannelId ? 'secondary' : 'outline'}>
            {activeChannelId ? `Posting to: ${activeChannelId}` : 'No channel configured'}
          </Badge>
        </div>
      </div>
    </div>
  );
}