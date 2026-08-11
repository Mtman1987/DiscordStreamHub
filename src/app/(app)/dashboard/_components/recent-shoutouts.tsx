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
import { useCollection, useDataStore, useDoc, useMemoData } from '@/data';
import { collection, doc } from '@/lib/data-shim';
import type { TimestampLike, UserProfile } from '@/lib/types';
import { timestampToDate } from '@/lib/date-utils';
import { Radio } from 'lucide-react';

type DashboardUser = UserProfile & {
  twitchLogin?: string;
  displayName?: string;
};

type TwitchPollingConfig = {
  lastShoutouts?: Record<string, TimestampLike>;
};

export function RecentShoutouts() {
  const store = useDataStore();
  const [serverId, setServerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setServerId(localStorage.getItem('discordServerId'));
  }, []);

  const usersRef = useMemoData(() => {
    if (!store || !serverId) return null;
    return collection(store, 'servers', serverId, 'users');
  }, [store, serverId]);

  const pollingRef = useMemoData(() => {
    if (!store || !serverId) return null;
    return doc(store, 'servers', serverId, 'config', 'twitch-polling');
  }, [store, serverId]);

  const { data: users, isLoading: usersLoading } = useCollection<DashboardUser>(usersRef);
  const { data: polling, isLoading: pollingLoading } = useDoc<TwitchPollingConfig>(pollingRef);

  const recentShoutouts = React.useMemo(() => {
    const lastShoutouts = polling?.lastShoutouts || {};
    return Object.entries(lastShoutouts)
      .map(([twitchLogin, rawTimestamp]) => {
        const timestamp = timestampToDate(rawTimestamp);
        if (!timestamp) return null;
        const normalizedLogin = twitchLogin.toLowerCase();
        const user = users?.find((candidate) =>
          String(candidate.twitchLogin || candidate.username || '').toLowerCase() === normalizedLogin
        );
        return {
          twitchLogin,
          timestamp,
          user,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 6);
  }, [polling, users]);

  const isLoading = usersLoading || pollingLoading;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-headline">
          <Radio className="h-5 w-5 text-primary" />
          Shoutout Activity
        </CardTitle>
        <CardDescription>
          Real shoutouts recorded by the live Twitch polling service.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {isLoading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}

          {!isLoading && recentShoutouts.map(({ twitchLogin, timestamp, user }) => (
            <div key={`${twitchLogin}:${timestamp.getTime()}`} className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold">{user?.displayName || user?.username || twitchLogin}</span>
                  {user?.group ? <Badge variant={user.group === 'Crew' ? 'default' : 'secondary'}>{user.group}</Badge> : null}
                  {user?.isOnline ? <Badge variant="outline" className="border-emerald-400/30 text-emerald-300">Live</Badge> : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDistanceToNow(timestamp, { addSuffix: true })}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {user?.isOnline ? 'Active Discord shoutout for the current stream.' : 'Shoutout delivered by Discord Stream Hub.'}
              </p>
            </div>
          ))}

          {!isLoading && recentShoutouts.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center">
              <p className="font-medium">No shoutout activity recorded yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">When Twitch polling posts a shoutout, it will appear here automatically.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
