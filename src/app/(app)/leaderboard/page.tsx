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
import { Loader2, RefreshCw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PointsConfigCard } from './_components/points-config';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, doc, getDoc, orderBy, query, limit } from 'firebase/firestore';
import type { UserProfile, LeaderboardEntry } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';


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
  
  const leaderboardQuery = useMemoFirebase(() => {
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


  React.useEffect(() => {
    fetchAndCombineLeaderboardData();
  }, [fetchAndCombineLeaderboardData]);

  const refreshLeaderboard = () => {
    fetchAndCombineLeaderboardData();
  }
  
  const finalIsLoading = isLoading || isLoadingLeaderboard;


  return (
    <div className="space-y-8">
      <PageHeader
        title="Community Leaderboard"
        description="A real-time view of the top contributors in your community."
      >
        <Button onClick={refreshLeaderboard} disabled={finalIsLoading}>
            {finalIsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
        </Button>
      </PageHeader>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Top Contributors</CardTitle>
                    <CardDescription>
                        This table updates to reflect the latest point totals.
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
        </div>
        <div className="lg:col-span-1">
            {serverId && <PointsConfigCard serverId={serverId} />}
        </div>
      </div>
    </div>
  );
}
