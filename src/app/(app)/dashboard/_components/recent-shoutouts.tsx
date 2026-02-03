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
import { recentShoutouts } from '@/lib/data';
import { Skeleton } from '@/components/ui/skeleton';

export function RecentShoutouts() {
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    // Simulate loading
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);


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

          {!isLoading && recentShoutouts.map((shoutout) => (
              <div key={shoutout.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{shoutout.streamerName}</span>
                    <Badge
                      variant={
                        shoutout.groupType === 'VIP'
                          ? 'default'
                          : shoutout.groupType === 'Raid Train'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {shoutout.groupType}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(shoutout.timestamp, { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-md">
                  {shoutout.message}
                </p>
              </div>
            )
          )}
          {!isLoading && (!recentShoutouts || recentShoutouts.length === 0) && (
            <p className="text-center text-muted-foreground py-10">No recent shoutouts found.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
