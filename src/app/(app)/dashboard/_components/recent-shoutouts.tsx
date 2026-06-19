'use client';
import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useDataStore, useCollection, useMemoData } from '@/data';
import { collection, query, orderBy, limit } from '@/lib/data-shim';
import type { UserProfile } from '@/lib/types';
import { timestampToDateOrNow } from '@/lib/date-utils';

export function RecentShoutouts() {
  const store = useDataStore();
  const [serverId, setServerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setServerId(localStorage.getItem('discordServerId'));
  }, []);

  const usersRef = useMemoData(() => {
    if (!store || !serverId) return null;
    return query(
      collection(store, 'servers', serverId, 'users'),
      orderBy('shoutoutGeneratedAt', 'desc'),
      limit(5)
    );
  }, [store, serverId]);

  const { data: users, isLoading } = useCollection<UserProfile>(usersRef);
  const recentShoutouts = React.useMemo(() => {
    return users?.filter(u => u.dailyShoutout && u.shoutoutGeneratedAt) || [];
  }, [users]);


  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-headline">Recent Shoutouts</CardTitle>
        <CardDescription>
          A log of the latest generated shoutouts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {isLoading && Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
                <div className="flex justify-between">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-12 w-full" />
            </div>
          ))}

          {!isLoading && recentShoutouts.map((user) => {
            const timestamp = timestampToDateOrNow(user.shoutoutGeneratedAt);
            const description = user.dailyShoutout?.embeds?.[0]?.description || user.dailyShoutout?.description || 'Shoutout generated';
            return (
              <div key={user.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{user.username}</span>
                    <Badge
                      variant={
                        user.group === 'VIP' || user.group === 'Crew'
                          ? 'default'
                          : user.group === 'Raid Train'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {user.group}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(timestamp, { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-md line-clamp-2">
                  {description}
                </p>
              </div>
            );
          })}
          {!isLoading && (!recentShoutouts || recentShoutouts.length === 0) && (
            <p className="text-center text-muted-foreground py-10">No recent shoutouts found.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
