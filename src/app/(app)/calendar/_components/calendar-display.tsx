'use client';

import * as React from 'react';
import {
  collection,
  query,
  where,
  orderBy,
} from '@/lib/data-shim';
import { useDataStore, useCollection, useMemoData } from '@/data';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import type { CalendarEvent } from '@/lib/types';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth } from 'date-fns';
import { Star } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar } from '@/components/ui/calendar';
import { DayProps } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { timestampToDate } from '@/lib/date-utils';

const CalendarContext = React.createContext<{ allEvents: CalendarEvent[] }>({ allEvents: [] });
const useCalendarContext = () => React.useContext(CalendarContext);


// Custom Day Component for the calendar
function CustomDay(props: DayProps) {
    const { date, displayMonth } = props;
    const { allEvents } = useCalendarContext();

    // Only render decorations for the current display month to avoid clutter.
    if (!isSameMonth(date, displayMonth)) {
        return <>{format(date, 'd')}</>;
    }

    const captainsLog = allEvents.find(e => 
      e.type === 'captains-log' && 
      isSameDay(timestampToDate(e.eventDateTime) ?? new Date(0), date)
    );

    const hasOtherEvents = allEvents.some(e => 
      e.type !== 'captains-log' &&
      isSameDay(timestampToDate(e.eventDateTime) ?? new Date(0), date)
    );

    return (
        <div className="relative h-full w-full">
            {format(date, 'd')}
            {hasOtherEvents && <Star className="absolute top-0.5 right-0.5 h-6 w-6 fill-yellow-400 text-yellow-500 z-20" />}
            {captainsLog && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Avatar className="absolute bottom-0.5 left-0.5 h-10 w-10 z-10">
                                <AvatarImage src={captainsLog.userAvatar} alt={captainsLog.username} />
                                <AvatarFallback>{captainsLog.username?.charAt(0)}</AvatarFallback>
                            </Avatar>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{"Captain's Log"} by {captainsLog.username}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
}


export function CalendarDisplay({ serverId, forScreenshot = false }: { serverId: string | null, forScreenshot?: boolean }) {
  const store = useDataStore();
  const [month, setMonth] = React.useState(startOfMonth(new Date()));

  const viewStart = startOfWeek(startOfMonth(month));
  const viewEnd = endOfWeek(endOfMonth(month));

  const eventsQuery = useMemoData(() => {
      if (!store || !serverId) return null;
      const eventsRef = collection(store, 'servers', serverId, 'calendarEvents');
      return query(
        eventsRef,
        where('eventDateTime', '>=', viewStart),
        where('eventDateTime', '<=', viewEnd),
        orderBy('eventDateTime', 'asc')
      );
  }, [store, serverId, viewStart, viewEnd]);

  const { data: allEvents } = useCollection<CalendarEvent>(eventsQuery);

  const { monthCaptains } = React.useMemo(() => {
    if (!allEvents) return { monthCaptains: [] };
    
    // Get all of this month's Captain's Logs for the left-hand footer avatar list.
    const monthCaptainLogs = allEvents.filter(e => 
        e.type === 'captains-log' &&
        isSameMonth(timestampToDate(e.eventDateTime) ?? new Date(0), month)
    );

    // Group logs by user to count them.
    const captainGroups = monthCaptainLogs.reduce((acc, log) => {
        if (!acc[log.userId]) {
            acc[log.userId] = {
                userAvatar: log.userAvatar,
                username: log.username,
                count: 0
            };
        }
        acc[log.userId].count++;
        return acc;
    }, {} as Record<string, { userAvatar: string; username: string; count: number }>);
    
    const sortedCaptains = Object.values(captainGroups).sort((a, b) => b.count - a.count);

    return { 
        monthCaptains: sortedCaptains,
    };
  }, [allEvents, month]);

  return (
      <CalendarContext.Provider value={{ allEvents: allEvents || [] }}>
        <div className={cn(forScreenshot && "bg-background p-4")}>
            <Card className="flex flex-col h-full">
                <CardHeader>
                    <CardTitle className="font-headline">Calendar</CardTitle>
                    <CardDescription>{format(month, 'MMMM yyyy')}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex justify-center">
                    <Calendar
                        mode="single"
                        month={month}
                        onMonthChange={setMonth}
                        className="p-0"
                        classNames={{
                            cell: "h-12 w-12 text-center text-sm p-0 relative focus-within:relative focus-within:z-20 border",
                            head_cell: "text-muted-foreground rounded-md w-12 font-normal text-[0.8rem]",
                            day: cn(buttonVariants({ variant: "ghost" }), "h-12 w-12 p-0 font-normal aria-selected:opacity-100 rounded-none"),
                        }}
                        components={{
                            Day: CustomDay
                        }}
                    />
                </CardContent>
                 <CardFooter className="flex-col items-start gap-2 border-t pt-4">
                     {monthCaptains.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                            {monthCaptains.map(captain => (
                                 <TooltipProvider key={captain.username}>
                                    <Tooltip>
                                        <TooltipTrigger>
                                            <div className="relative">
                                                <Avatar>
                                                    <AvatarImage src={captain.userAvatar} alt={captain.username} />
                                                    <AvatarFallback>{captain.username.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="absolute -bottom-1 -right-2 bg-primary text-primary-foreground text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center border-2 border-card">
                                                    {captain.count}
                                                </div>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>{captain.username} logged {captain.count} day(s)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No captains have logged days this month.</p>
                    )}
                </CardFooter>
            </Card>
        </div>
      </CalendarContext.Provider>
  );
}
