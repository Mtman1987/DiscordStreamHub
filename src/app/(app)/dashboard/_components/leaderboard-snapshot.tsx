'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowRight, Trophy } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { LeaderboardEntry, UserProfile } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function LeaderboardSnapshot() {
  const firestore = useFirestore();
  const [serverId, setServerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setServerId(localStorage.getItem('discordServerId'));
  }, []);

  const leaderboardRef = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return query(
      collection(firestore, 'servers', serverId, 'leaderboard'),
      orderBy('points', 'desc'),
      limit(3)
    );
  }, [firestore, serverId]);

  const usersRef = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return collection(firestore, 'servers', serverId, 'users');
  }, [firestore, serverId]);

  const { data: leaderboard, isLoading: isLoadingLeaderboard } = useCollection<LeaderboardEntry>(leaderboardRef);
  const { data: allUsers } = useCollection<UserProfile>(usersRef);

  const topUsers = React.useMemo(() => {
    if (!leaderboard || !allUsers) return [];
    return leaderboard.map(entry => {
      const user = allUsers.find(u => u.id === entry.userProfileId);
      return { ...entry, user };
    }).filter(item => item.user);
  }, [leaderboard, allUsers]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-xl font-headline">Leaderboard</CardTitle>
          <CardDescription>Top community contributors.</CardDescription>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href="/leaderboard">
            View All
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoadingLeaderboard ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : topUsers.length > 0 ? (
          <div className="space-y-3">
            {topUsers.map((item, index) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="relative">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={item.user?.avatarUrl} alt={item.user?.username} />
                    <AvatarFallback>{item.user?.username?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  {index === 0 && (
                    <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-yellow-500 flex items-center justify-center">
                      <Trophy className="h-3 w-3 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{item.user?.username}</p>
                  <p className="text-xs text-muted-foreground">{item.points.toLocaleString()} points</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-6 text-sm">No leaderboard data yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
