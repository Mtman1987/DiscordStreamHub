'use client';

import * as React from 'react';
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Trophy, Send, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PointsConfigCard } from './_components/points-config';
import { useCollection, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import { collection, doc, getDoc, orderBy, query, limit } from 'firebase/firestore';
import type { UserProfile, LeaderboardEntry } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DiscordChannel {
  id: string;
  name: string;
}


type LeaderboardDisplayEntry = LeaderboardEntry & { user?: UserProfile, rank: number };

export default function LeaderboardPage() {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [leaderboardData, setLeaderboardData] = React.useState<LeaderboardDisplayEntry[]>([]);
  const [adminLeaderboardData, setAdminLeaderboardData] = React.useState<LeaderboardDisplayEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingAdmin, setIsLoadingAdmin] = React.useState(true);
  const [selectedChannelId, setSelectedChannelId] = React.useState('');
  const [selectedAdminChannelId, setSelectedAdminChannelId] = React.useState('');
  const [isPostingLeaderboard, setIsPostingLeaderboard] = React.useState(false);
  const [isPostingAdminLeaderboard, setIsPostingAdminLeaderboard] = React.useState(false);

  React.useEffect(() => {
    const storedServerId = localStorage.getItem('discordServerId');
    const storedChannelId = localStorage.getItem('leaderboardChannelId');
    const storedAdminChannelId = localStorage.getItem('adminLeaderboardChannelId');
    if (storedServerId) {
      setServerId(storedServerId);
    } else {
        setIsLoading(false);
        setIsLoadingAdmin(false);
        toast({
            variant: 'destructive',
            title: 'Configuration Error',
            description: 'Could not find a Discord Server ID in local storage. Please log in again.',
        });
    }
    if (storedChannelId) setSelectedChannelId(storedChannelId);
    if (storedAdminChannelId) setSelectedAdminChannelId(storedAdminChannelId);
  }, [toast]);

  const channelsConfigRef = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId, 'config', 'channels');
  }, [firestore, serverId]);

  const { data: channelsData } = useDoc<{ list: DiscordChannel[] }>(channelsConfigRef);
  const channels = channelsData?.list ?? [];
  
  const leaderboardQuery = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return query(collection(firestore, 'servers', serverId, 'leaderboard'), orderBy('points', 'desc'), limit(50));
  }, [firestore, serverId]);

  const adminLeaderboardQuery = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return query(collection(firestore, 'servers', serverId, 'adminLeaderboard'), orderBy('points', 'desc'), limit(50));
  }, [firestore, serverId]);

  const { data: rawLeaderboard, isLoading: isLoadingLeaderboard } = useCollection<LeaderboardEntry>(leaderboardQuery);
  const { data: rawAdminLeaderboard, isLoading: isLoadingAdminLeaderboard } = useCollection<LeaderboardEntry>(adminLeaderboardQuery);

  const fetchAndCombineLeaderboardData = React.useCallback(async () => {
    if (!rawLeaderboard || !firestore || !serverId) return;
    
    setIsLoading(true);
    const combinedData: LeaderboardDisplayEntry[] = [];
    let rank = 1;
    for (const entry of rawLeaderboard) {
        let userProfile: UserProfile | undefined = undefined;
        try {
            const userDocRef = doc(firestore, 'servers', serverId, 'users', entry.userProfileId);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
                userProfile = userDocSnap.data() as UserProfile;
            }
        } catch (e) {
            console.error(`Failed to fetch profile for ${entry.userProfileId}`, e);
        }
        combinedData.push({ ...entry, user: userProfile, rank });
        rank++;
    }
    setLeaderboardData(combinedData);
    setIsLoading(false);
  }, [rawLeaderboard, firestore, serverId]);

  const fetchAndCombineAdminLeaderboardData = React.useCallback(async () => {
    if (!rawAdminLeaderboard || !firestore || !serverId) return;
    
    setIsLoadingAdmin(true);
    const combinedData: LeaderboardDisplayEntry[] = [];
    let rank = 1;
    for (const entry of rawAdminLeaderboard) {
        let userProfile: UserProfile | undefined = undefined;
        try {
            const userDocRef = doc(firestore, 'servers', serverId, 'users', entry.userProfileId);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
                userProfile = userDocSnap.data() as UserProfile;
            }
        } catch (e) {
            console.error(`Failed to fetch profile for ${entry.userProfileId}`, e);
        }
        combinedData.push({ ...entry, user: userProfile, rank });
        rank++;
    }
    setAdminLeaderboardData(combinedData);
    setIsLoadingAdmin(false);
  }, [rawAdminLeaderboard, firestore, serverId]);


  React.useEffect(() => {
    fetchAndCombineLeaderboardData();
  }, [fetchAndCombineLeaderboardData]);

  React.useEffect(() => {
    fetchAndCombineAdminLeaderboardData();
  }, [fetchAndCombineAdminLeaderboardData]);

  const refreshLeaderboard = () => {
    fetchAndCombineLeaderboardData();
    fetchAndCombineAdminLeaderboardData();
  }

  const handlePostLeaderboard = async () => {
    if (!serverId) {
      toast({ variant: 'destructive', title: 'Server missing', description: 'Set a Discord server before posting.' });
      return;
    }
    if (!selectedChannelId) {
      toast({ variant: 'destructive', title: 'Channel required', description: 'Select a Discord channel.' });
      return;
    }
    setIsPostingLeaderboard(true);
    try {
      const response = await fetch('/api/leaderboard/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, channelId: selectedChannelId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to post leaderboard.');
      }
      localStorage.setItem('leaderboardChannelId', selectedChannelId);
      toast({ title: 'Leaderboard posted', description: 'Top 10 sent to Discord.' });
    } catch (error) {
      console.error('Failed to post leaderboard:', error);
      toast({ variant: 'destructive', title: 'Post failed', description: error instanceof Error ? error.message : 'Could not post to Discord.' });
    } finally {
      setIsPostingLeaderboard(false);
    }
  };
  
  const handlePostAdminLeaderboard = async () => {
    if (!serverId) {
      toast({ variant: 'destructive', title: 'Server missing', description: 'Set a Discord server before posting.' });
      return;
    }
    if (!selectedAdminChannelId) {
      toast({ variant: 'destructive', title: 'Channel required', description: 'Select a Discord channel.' });
      return;
    }
    setIsPostingAdminLeaderboard(true);
    try {
      const response = await fetch('/api/leaderboard/post-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, channelId: selectedAdminChannelId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to post admin leaderboard.');
      }
      localStorage.setItem('adminLeaderboardChannelId', selectedAdminChannelId);
      toast({ title: 'Admin leaderboard posted', description: 'Top 10 sent to Discord.' });
    } catch (error) {
      console.error('Failed to post admin leaderboard:', error);
      toast({ variant: 'destructive', title: 'Post failed', description: error instanceof Error ? error.message : 'Could not post to Discord.' });
    } finally {
      setIsPostingAdminLeaderboard(false);
    }
  };
  
  const finalIsLoading = isLoading || isLoadingLeaderboard;
  const finalIsLoadingAdmin = isLoadingAdmin || isLoadingAdminLeaderboard;


  return (
    <div className="space-y-8">
      <PageHeader
        title="Community Leaderboard"
        description="A real-time view of the top contributors in your community."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={refreshLeaderboard} disabled={finalIsLoading}>
              {finalIsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
          </Button>
          <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-white/20 bg-white/5 p-2 text-sm sm:w-auto sm:flex-nowrap">
            <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    #{c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handlePostLeaderboard} disabled={isPostingLeaderboard}>
              {isPostingLeaderboard && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Send className="mr-2 h-4 w-4" />
              Post Top 10
            </Button>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-2 text-sm sm:w-auto sm:flex-nowrap">
            <Select value={selectedAdminChannelId} onValueChange={setSelectedAdminChannelId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Admin channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    #{c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handlePostAdminLeaderboard} disabled={isPostingAdminLeaderboard} variant="outline">
              {isPostingAdminLeaderboard && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Star className="mr-2 h-4 w-4" />
              Post Admin Top 10
            </Button>
          </div>
        </div>
      </PageHeader>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Top Contributors</CardTitle>
                    <CardDescription>
                        Community activity points from Twitch chat, raids, subs, and more.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                   <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[80px]">Rank</TableHead>
                                <TableHead>User</TableHead>
                                <TableHead className="text-right">Points</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {finalIsLoading && Array.from({length: 5}).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-4">
                                            <Skeleton className="h-10 w-10 rounded-full" />
                                            <div className="space-y-1">
                                                 <Skeleton className="h-4 w-32" />
                                                 <Skeleton className="h-3 w-24" />
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right"><Skeleton className="h-6 w-16 ml-auto" /></TableCell>
                                </TableRow>
                            ))}
                            {!finalIsLoading && leaderboardData.map((entry) => (
                                <TableRow key={entry.id}>
                                    <TableCell className="font-bold text-lg text-center">
                                        {entry.rank === 1 && <Trophy className="w-6 h-6 text-yellow-500" />}
                                        {entry.rank === 2 && <Trophy className="w-6 h-6 text-gray-400" />}
                                        {entry.rank === 3 && <Trophy className="w-6 h-6 text-orange-400" />}
                                        {entry.rank > 3 && entry.rank}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-4">
                                            <Avatar>
                                                <AvatarImage src={entry.user?.avatarUrl} alt={entry.user?.username}/>
                                                <AvatarFallback>{entry.user?.username?.charAt(0) ?? '?'}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium">{entry.user?.username ?? 'Unknown User'}</p>
                                                <p className="text-sm text-muted-foreground">ID: {entry.userProfileId}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-lg">{entry.points.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                   </Table>
                    {!finalIsLoading && leaderboardData.length === 0 && (
                        <p className="text-center text-muted-foreground py-12">No leaderboard data found.</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Star className="h-5 w-5 text-yellow-500" />
                        Admin Leaderboard
                    </CardTitle>
                    <CardDescription>
                        Points from calendar events, captain's logs, and admin messages.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                   <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[80px]">Rank</TableHead>
                                <TableHead>User</TableHead>
                                <TableHead className="text-right">Points</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {finalIsLoadingAdmin && Array.from({length: 5}).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-4">
                                            <Skeleton className="h-10 w-10 rounded-full" />
                                            <div className="space-y-1">
                                                 <Skeleton className="h-4 w-32" />
                                                 <Skeleton className="h-3 w-24" />
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right"><Skeleton className="h-6 w-16 ml-auto" /></TableCell>
                                </TableRow>
                            ))}
                            {!finalIsLoadingAdmin && adminLeaderboardData.map((entry) => (
                                <TableRow key={entry.id}>
                                    <TableCell className="font-bold text-lg text-center">
                                        {entry.rank === 1 && <Trophy className="w-6 h-6 text-yellow-500" />}
                                        {entry.rank === 2 && <Trophy className="w-6 h-6 text-gray-400" />}
                                        {entry.rank === 3 && <Trophy className="w-6 h-6 text-orange-400" />}
                                        {entry.rank > 3 && entry.rank}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-4">
                                            <Avatar>
                                                <AvatarImage src={entry.user?.avatarUrl} alt={entry.user?.username}/>
                                                <AvatarFallback>{entry.user?.username?.charAt(0) ?? '?'}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium">{entry.user?.username ?? 'Unknown User'}</p>
                                                <p className="text-sm text-muted-foreground">ID: {entry.userProfileId}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-lg">{entry.points.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                   </Table>
                    {!finalIsLoadingAdmin && adminLeaderboardData.length === 0 && (
                        <p className="text-center text-muted-foreground py-12">No admin leaderboard data found.</p>
                    )}
                </CardContent>
            </Card>
        </div>
        <div className="lg:col-span-1">
            {serverId && <PointsConfigCard serverId={serverId} />}
        </div>
      </div>
    </div>
  );
}
