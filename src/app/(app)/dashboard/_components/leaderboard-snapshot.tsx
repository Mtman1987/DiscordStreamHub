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
import { useDataStore, useCollection, useMemoData } from '@/data';
import { collection, query, orderBy, limit } from '@/lib/data-shim';
import type { LeaderboardEntry, UserProfile } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function LeaderboardSnapshot() {
  const store = useDataStore();
  const [serverId, setServerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setServerId(localStorage.getItem('discordServerId'));
  }, []);

  const leaderboardRef = useMemoData(() => {
    if (!store || !serverId) return null;
    return query(
      collection(store, 'servers', serverId, 'leaderboard'),
      orderBy('points', 'desc'),
      limit(3)
    );
  }, [store, serverId]);

  const usersRef = useMemoData(() => {
    if (!store || !serverId) return null;
    return collection(store, 'servers', serverId, 'users');
  }, [store, serverId]);

  const { data: leaderboard, isLoading: isLoadingLeaderboard } = useCollection<LeaderboardEntry>(leaderboardRef);
  const { data: allUsers } = useCollection<UserProfile>(usersRef);

  const topUsers = React.useMemo(() => {
    if (!leaderboard || !allUsers) return [];
    return leaderboard.map(entry => {
      const user = allUsers.find(u => u.id === entry.userProfileId);
      return { ...entry, user };
    }).filter(item => item.user)
      .sort((a, b) => Number(b.points || 0) - Number(a.points || 0));
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
          <div className="space-y-2">
            {topUsers.map((item, index) => (
              <div key={item.id} className="flex min-h-[64px] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-sm font-bold text-cyan-100">
                  {index + 1}
                </div>
                <div className="relative">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={item.user?.avatarUrl} alt={item.user?.username} />
                    <AvatarFallback>{item.user?.username?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  {index === 0 && (
                    <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500">
                      <Trophy className="h-3 w-3 text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.user?.username}</p>
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
