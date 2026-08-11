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
import { ArrowRight, Calendar, Users, Megaphone, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useDataStore, useCollection, useMemoData } from '@/data';
import { collection, query, orderBy, limit, where } from '@/lib/data-shim';
import type { CalendarEvent } from '@/lib/types';
import { timestampToDate } from '@/lib/date-utils';

const iconMap: Record<string, React.ReactNode> = {
  event: <Users className="h-4 w-4 text-muted-foreground" />,
  meeting: <Calendar className="h-4 w-4 text-muted-foreground" />,
  qotd: <Megaphone className="h-4 w-4 text-muted-foreground" />,
  'captains-log': <BookOpen className="h-4 w-4 text-muted-foreground" />,
};

export function UpcomingEvents() {
  const store = useDataStore();
  const [serverId, setServerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setServerId(localStorage.getItem('discordServerId'));
  }, []);

  const eventsRef = useMemoData(() => {
    if (!store || !serverId) return null;
    return query(
      collection(store, 'servers', serverId, 'calendarEvents'),
      where('eventDateTime', '>=', new Date()),
      orderBy('eventDateTime', 'asc'),
      limit(20)
    );
  }, [store, serverId]);

  const { data: allEvents, isLoading } = useCollection<CalendarEvent>(eventsRef);

  const events = React.useMemo(() => {
    const now = Date.now();
    return (allEvents || [])
      .flatMap((event) => {
        const eventDate = timestampToDate(event.eventDateTime);
        if (event.type === 'captains-log' || !eventDate || eventDate.getTime() < now) return [];
        return [{ event, eventDate }];
      })
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())
      .slice(0, 4);
  }, [allEvents]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-xl font-headline">Upcoming Events</CardTitle>
          <CardDescription>Future events only — stale calendar entries stay off the dashboard.</CardDescription>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href="/calendar">
            View All
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading && Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
          {!isLoading && events.map(({ event, eventDate }) => (
            <div key={event.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                {iconMap[event.type] || <Calendar className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{event.eventName}</p>
                <p className="text-sm text-muted-foreground">
                  {format(eventDate, 'MMM d, yyyy · h:mm a')}
                </p>
              </div>
            </div>
          ))}
          {!isLoading && events.length === 0 && (
            <p className="py-6 text-center text-muted-foreground">No upcoming events scheduled.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
