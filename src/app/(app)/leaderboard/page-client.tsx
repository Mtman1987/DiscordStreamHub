'use client';

import * as React from 'react';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Trophy, Medal, Award, Download } from 'lucide-react';
import { PointsConfigCard } from './_components/points-config';
import { LeaderboardChannelConfig } from './_components/leaderboard-channel-config';
import { useCollection, useFirestore } from '@/firebase';
import { collection, doc, getDoc, orderBy, query, limit } from 'firebase/firestore';
import type { UserProfile, LeaderboardEntry } from '@/lib/types';

type LeaderboardDisplayEntry = LeaderboardEntry & { user?: UserProfile, rank: number };

export default function LeaderboardPage() {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [leaderboardData, setLeaderboardData] = React.useState<LeaderboardDisplayEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const storedServerId = localStorage.getItem('discordServerId');
    if (storedServerId) {
      setServerId(storedServerId);
    } else {
        setIsLoading(false);
        toast({
            variant: 'destructive',
            title: 'Configuration Error',
            description: 'Could not find a Discord Server ID in local storage. Please log in again.',
        });
    }
  }, [toast]);
  
  const leaderboardQuery = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return query(collection(firestore, 'servers', serverId, 'leaderboard'), orderBy('points', 'desc'), limit(50));
  }, [firestore, serverId]);

  const { data: rawLeaderboard, isLoading: isLoadingLeaderboard } = useCollection<LeaderboardEntry>(leaderboardQuery);

  const fetchAndCombineLeaderboardData = React.useCallback(async () => {
    if (!rawLeaderboard || !firestore || !serverId) return;
    
    setIsLoading(true);
    const combinedData: LeaderboardDisplayEntry[] = [];
    let rank = 1;
    for (const entry of rawLeaderboard) {
        let userProfile: UserProfile | undefined = undefined;
        const userDocRef = doc(firestore, 'servers', serverId, 'users', entry.userProfileId);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            userProfile = userDocSnap.data() as UserProfile;
        }
        combinedData.push({ ...entry, user: userProfile, rank });
        rank++;
    }
    setLeaderboardData(combinedData);
    setIsLoading(false);
  }, [rawLeaderboard, firestore, serverId]);

  React.useEffect(() => {
    fetchAndCombineLeaderboardData();
  }, [fetchAndCombineLeaderboardData]);

  const refreshLeaderboard = () => {
    fetchAndCombineLeaderboardData();
  }

  const downloadLeaderboardImage = async () => {
    try {
      const response = await fetch('/api/points/leaderboard-image');
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `space-mountain-leaderboard-${new Date().toISOString().split('T')[0]}.png`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        toast({
          title: "Leaderboard Downloaded!",
          description: "The leaderboard image has been saved to your downloads.",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: "Could not download leaderboard image.",
      });
    }
  };
  
  const finalIsLoading = isLoading || isLoadingLeaderboard;

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            margin: '0 0 8px 0',
            background: 'linear-gradient(45deg, #667eea, #764ba2)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            🏆 Community Leaderboard
          </h1>
          <p style={{ color: '#888', margin: 0 }}>
            A real-time view of the top contributors in your community.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={downloadLeaderboardImage}
            style={{
              padding: '12px 20px',
              backgroundColor: 'transparent',
              color: '#667eea',
              border: '1px solid #667eea',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            📥 Download Image
          </button>
          <button
            onClick={async () => {
              try {
                const response = await fetch('/api/points/add', {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer 1234'
                  },
                  body: JSON.stringify({ 
                    userId: '767875979561009173',
                    username: 'mtman1987', 
                    displayName: 'mtman1987',
                    points: 200 
                  })
                });
                if (response.ok) {
                  toast({ title: 'Added 200 points to mtman1987!' });
                  refreshLeaderboard();
                } else {
                  throw new Error('Failed to add points');
                }
              } catch (error) {
                toast({ variant: 'destructive', title: 'Error adding points' });
              }
            }}
            style={{
              padding: '12px 20px',
              backgroundColor: '#f59e0b',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            ⚡ +200 Points
          </button>
          <button
            onClick={refreshLeaderboard}
            disabled={finalIsLoading}
            style={{
              padding: '12px 20px',
              backgroundColor: '#667eea',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: finalIsLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: finalIsLoading ? 0.6 : 1
            }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px' }}>
        <div style={{
          backgroundColor: '#1a1a2e',
          border: '1px solid #333',
          borderRadius: '12px',
          padding: '24px'
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 8px 0' }}>Top Contributors</h2>
          <p style={{ color: '#888', margin: '0 0 24px 0', fontSize: '14px' }}>
            This table updates to reflect the latest point totals.
          </p>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ padding: '12px', textAlign: 'left', width: '80px' }}>Rank</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>User</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {finalIsLoading && Array.from({length: 5}).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ width: '32px', height: '32px', backgroundColor: '#333', borderRadius: '4px' }}></div>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ width: '40px', height: '40px', backgroundColor: '#333', borderRadius: '50%' }}></div>
                        <div>
                          <div style={{ width: '128px', height: '16px', backgroundColor: '#333', borderRadius: '4px', marginBottom: '4px' }}></div>
                          <div style={{ width: '96px', height: '12px', backgroundColor: '#333', borderRadius: '4px' }}></div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <div style={{ width: '64px', height: '24px', backgroundColor: '#333', borderRadius: '4px', marginLeft: 'auto' }}></div>
                    </td>
                  </tr>
                ))}
                {!finalIsLoading && leaderboardData.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #333' }}>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }}>
                      {entry.rank === 1 && <span style={{ fontSize: '24px' }}>🥇</span>}
                      {entry.rank === 2 && <span style={{ fontSize: '24px' }}>🥈</span>}
                      {entry.rank === 3 && <span style={{ fontSize: '24px' }}>🥉</span>}
                      {entry.rank > 3 && entry.rank}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        {entry.user?.avatarUrl ? (
                          <Image 
                            src={entry.user.avatarUrl} 
                            alt={entry.user.username || 'Leaderboard avatar'}
                            width={40}
                            height={40}
                            unoptimized
                            style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '50%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            backgroundColor: '#667eea',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '16px',
                            fontWeight: 'bold'
                          }}>
                            {entry.user?.username?.charAt(0) ?? '?'}
                          </div>
                        )}
                        <div>
                          <p style={{ margin: 0, fontWeight: '500' }}>{entry.user?.username ?? 'Unknown User'}</p>
                          <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>ID: {entry.userProfileId}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontSize: '18px' }}>
                      {entry.points.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!finalIsLoading && leaderboardData.length === 0 && (
              <p style={{ textAlign: 'center', color: '#888', padding: '48px 0' }}>No leaderboard data found.</p>
            )}
          </div>
        </div>
        
        <div>
          {serverId && (
            <>
              <LeaderboardChannelConfig serverId={serverId} />
              <PointsConfigCard serverId={serverId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
