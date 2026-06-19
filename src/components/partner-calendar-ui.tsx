'use client';

/* eslint-disable @next/next/no-img-element */
import * as React from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';

type CalendarEvent = {
  id: string;
  eventName?: string;
  description?: string;
  type?: string;
  eventDateTime?: { toDate(): Date } | Date;
  isRecurring?: boolean;
};

type PartnerCalendarProps = {
  month: Date;
  events: CalendarEvent[];
  username: string;
  avatar?: string;
};

function resolveDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

export function PartnerCalendar({ month, events, username, avatar }: PartnerCalendarProps) {
  const viewStart = startOfWeek(startOfMonth(month));
  const viewEnd = endOfWeek(endOfMonth(month));

  const cells: Date[] = [];
  const cursor = new Date(viewStart);
  while (cursor <= viewEnd) {
    cells.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach(event => {
      const date = resolveDate(event.eventDateTime);
      if (!date) return;
      const key = format(date, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    });
    return map;
  }, [events]);

  const upcomingStreams = React.useMemo(() => {
    const now = new Date();
    const uniqueDates = new Map<string, { event: CalendarEvent; date: Date }>();
    
    events
      .map(e => ({ event: e, date: resolveDate(e.eventDateTime) }))
      .filter(({ date }) => date && date >= now)
      .sort((a, b) => a.date!.getTime() - b.date!.getTime())
      .forEach(({ event, date }) => {
        const dateKey = format(date!, 'yyyy-MM-dd-HH-mm');
        if (!uniqueDates.has(dateKey)) {
          uniqueDates.set(dateKey, { event, date: date! });
        }
      });
    
    return Array.from(uniqueDates.values()).slice(0, 5);
  }, [events]);

  return (
    <div className="w-[1200px] h-[900px] bg-gradient-to-br from-purple-950 via-purple-900 to-indigo-950 text-white p-8">
      <div className="flex flex-col gap-6 h-full">
        {/* Header */}
        <div className="flex items-center gap-4 pb-4 border-b border-white/20">
          {avatar && (
            <img src={avatar} alt={username} className="w-16 h-16 rounded-full border-2 border-purple-400" />
          )}
          <div>
            <h1 className="text-3xl font-bold">{username}{"'s Stream Schedule"}</h1>
            <p className="text-purple-200">{format(month, 'MMMM yyyy')}</p>
          </div>
        </div>

        <div className="grid grid-cols-[2fr,1fr] gap-6 flex-1">
          {/* Calendar */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
            <div className="grid grid-cols-7 text-center text-sm text-purple-200 mb-4 font-semibold">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day}>{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {cells.map((date, idx) => {
                const key = format(date, 'yyyy-MM-dd');
                const dayEvents = eventsByDay.get(key) || [];
                const isCurrentMonth = isSameMonth(date, month);
                const isToday = isSameDay(date, new Date());

                return (
                  <div
                    key={idx}
                    className={cn(
                      'h-20 rounded-lg border p-2 text-sm',
                      isCurrentMonth ? 'bg-white/5 border-white/10 text-white' : 'bg-transparent border-white/5 text-white/30',
                      isToday && 'bg-purple-600/50 border-purple-400',
                      dayEvents.length > 0 && 'bg-purple-500/30 border-purple-400'
                    )}
                  >
                    <div className="font-semibold">{date.getDate()}</div>
                    {dayEvents.length > 0 && (
                      <div className="text-xs mt-1 space-y-0.5">
                        {dayEvents.slice(0, 2).map((event, i) => (
                          <div key={i} className="truncate text-purple-200">
                            {format(resolveDate(event.eventDateTime)!, 'h:mm a')}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Upcoming Streams */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
            <h2 className="text-xl font-bold mb-4 text-purple-200">Upcoming Streams</h2>
            <div className="space-y-3">
              {upcomingStreams.length > 0 ? (
                upcomingStreams.map(({ event, date }) => (
                  <div key={event.id} className="rounded-lg bg-purple-600/30 border border-purple-400/50 p-3">
                    <div className="font-semibold text-white">{event.eventName}</div>
                    <div className="text-sm text-purple-200 mt-1">
                      {format(date!, 'MMM dd · h:mm a')}
                    </div>
                    {event.isRecurring && (
                      <div className="text-xs text-purple-300 mt-1">🔄 Recurring</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center text-purple-300 py-8">
                  No upcoming streams scheduled
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-purple-300 border-t border-white/20 pt-4">
          Schedule synced from Twitch · Times in CT
        </div>
      </div>
    </div>
  );
}
