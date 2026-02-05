'use client';

import Image from 'next/image';
import * as React from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';

type SerializableTimestamp = {
  seconds: number;
  nanoseconds?: number;
};

type CalendarEvent = {
  id: string;
  type?: string;
  username?: string;
  userAvatar?: string | null;
  userId?: string;
  eventName?: string;
  description?: string;
  eventDateTime?:
    | { toDate(): Date }
    | Date
    | number
    | string
    | SerializableTimestamp
    | null;
};

export type CaptainStat = {
  username: string;
  userAvatar?: string | null;
  count: number;
};

type MissionCalendarProps = {
  month: Date;
  today: Date;
  allEvents: CalendarEvent[];
  monthCaptains: CaptainStat[];
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  className?: string;
};

type MissionLogProps = {
  missionEvents: CalendarEvent[];
  todaysCaptain: CalendarEvent | null;
  className?: string;
};

const colorClasses = [
  'text-purple-400',
  'text-blue-400',
  'text-green-400',
  'text-yellow-300',
  'text-pink-400',
  'text-orange-400',
];
const glyphs = ['🟣', '🔵', '🟢', '🟡', '💗', '🟠'];

function getEventColorClass(eventId: string) {
  const hash = eventId.split('').reduce((acc, char) => (acc * 33 + char.charCodeAt(0)) % colorClasses.length, 0);
  return colorClasses[Math.abs(hash) % colorClasses.length];
}

function getEventGlyph(eventId: string) {
  const hash = eventId.split('').reduce((acc, char) => (acc * 29 + char.charCodeAt(0)) % glyphs.length, 0);
  return glyphs[Math.abs(hash) % glyphs.length];
}

function resolveEventDate(value: CalendarEvent['eventDateTime']): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'seconds' in value &&
    typeof (value as SerializableTimestamp).seconds === 'number'
  ) {
    const ts = value as SerializableTimestamp;
    const millis = ts.seconds * 1000 + Math.floor((ts.nanoseconds ?? 0) / 1_000_000);
    return new Date(millis);
  }
  return null;
}

function dateKey(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

export function MissionCalendarCard({
  month,
  today,
  allEvents,
  monthCaptains,
  onPrevMonth,
  onNextMonth,
  className,
}: MissionCalendarProps) {
  const { eventsByDay } = React.useMemo(() => {
    const map = new Map<string, { captainsLog: CalendarEvent | null; dayEvents: CalendarEvent[] }>();
    allEvents.forEach((event) => {
      const eventDate = resolveEventDate(event.eventDateTime);
      if (!eventDate) return;
      const key = dateKey(eventDate);
      if (!map.has(key)) {
        map.set(key, { captainsLog: null, dayEvents: [] });
      }
      const bucket = map.get(key)!;
      if (event.type === 'captains-log') {
        bucket.captainsLog = event;
      } else {
        bucket.dayEvents.push(event);
      }
    });
    return { eventsByDay: map };
  }, [allEvents]);

  const calendarMonth = month;
  const viewStart = startOfWeek(startOfMonth(calendarMonth));
  const viewEnd = endOfWeek(endOfMonth(calendarMonth));

  const cells: Date[] = [];
  const cursor = new Date(viewStart);
  while (cursor <= viewEnd) {
    cells.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <div className={cn('rounded-3xl bg-card border p-6 shadow-2xl', className)}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-blue-200">Mission Calendar</p>
          <h2 className="text-2xl font-bold">{format(calendarMonth, 'MMMM yyyy')}</h2>
          <p className="text-blue-200 text-sm">Fleet operations schedule</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevMonth}
            className="h-9 w-9 rounded-full border border-white/30 text-white hover:bg-white/10 disabled:opacity-30"
            disabled={!onPrevMonth}
          >
            ←
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="h-9 w-9 rounded-full border border-white/30 text-white hover:bg-white/10 disabled:opacity-30"
            disabled={!onNextMonth}
          >
            →
          </button>
        </div>
      </div>

      <div className="border border-white/10 rounded-2xl p-4 bg-white/5">
        <div className="grid grid-cols-7 text-center text-xs text-blue-200 mb-3 uppercase tracking-wide">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cellDate, idx) => {
            const key = dateKey(cellDate);
            const dayData = eventsByDay.get(key) || { captainsLog: null, dayEvents: [] };
            const isCurrentMonth = cellDate.getMonth() === calendarMonth.getMonth();
            const isToday = isSameDay(cellDate, today);

            return (
              <div
                key={`${key}-${idx}`}
                className={cn(
                  'relative h-16 rounded-xl border border-white/5 bg-white/5 px-1 py-1 text-left text-sm transition',
                  isCurrentMonth ? 'text-blue-50' : 'text-white/20',
                  isToday && 'bg-purple-600/70 border-purple-300 shadow-inner'
                )}
              >
                <div className="text-[11px] font-semibold relative z-10">{cellDate.getDate()}</div>
                {dayData.captainsLog && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    {dayData.captainsLog.userAvatar ? (
                      <Image
                        src={dayData.captainsLog.userAvatar}
                        alt={dayData.captainsLog.username || 'Captain'}
                        width={56}
                        height={56}
                        unoptimized
                        className="rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-purple-700 text-2xl font-bold flex items-center justify-center">
                        {dayData.captainsLog.username?.charAt(0) || '★'}
                      </div>
                    )}
                  </div>
                )}
                {dayData.dayEvents.length > 0 && (
                  <div className="absolute top-1 right-1 text-xl pointer-events-none z-10">
                    <span className={getEventColorClass(dayData.dayEvents[0].id)}>{getEventGlyph(dayData.dayEvents[0].id)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        {monthCaptains.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {monthCaptains.map((captain) => (
              <div
                key={`${captain.username}-${captain.count}`}
                className="relative flex items-center gap-2 bg-white/10 rounded-full px-3 py-1"
              >
                {captain.userAvatar ? (
                  <Image
                    src={captain.userAvatar}
                    alt={captain.username}
                    width={32}
                    height={32}
                    unoptimized
                    className="h-8 w-8 rounded-full border border-white/40"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-purple-700 text-white flex items-center justify-center font-bold">
                    {captain.username.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold leading-tight">{captain.username}</p>
                  <p className="text-[11px] text-blue-200 leading-tight">{captain.count} day(s)</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-blue-200">No captains have logged days this month.</p>
        )}
      </div>
    </div>
  );
}

export function MissionLogCard({ missionEvents, todaysCaptain, className }: MissionLogProps) {
  const upcoming = React.useMemo(() => {
    return missionEvents
      .map((event) => ({ event, date: resolveEventDate(event.eventDateTime) }))
      .filter(({ date }) => !!date)
      .sort((a, b) => (a.date!.getTime() - b.date!.getTime()))
      .map(({ event }) => event)
      .slice(0, 6);
  }, [missionEvents]);

  return (
    <div className={cn('rounded-3xl bg-card border p-5 shadow-2xl', className)}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-blue-200">Mission Log</p>
          <h2 className="text-xl font-bold">Upcoming fleet operations</h2>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3 rounded-2xl border bg-secondary/50 p-3">
        {todaysCaptain?.userAvatar ? (
          <Image
            src={todaysCaptain.userAvatar}
            alt={todaysCaptain.username || 'Captain'}
            width={48}
            height={48}
            unoptimized
            className="h-12 w-12 rounded-full border border-blue-200"
          />
        ) : (
          <div className="h-12 w-12 rounded-full bg-purple-700 text-white flex items-center justify-center text-lg font-bold border border-blue-200">
            {todaysCaptain?.username?.charAt(0) || '★'}
          </div>
        )}
        <div>
          <p className="text-sm text-blue-200">Today’s Captain</p>
          <p className="text-lg font-semibold">{todaysCaptain?.username ?? 'No captain logged today'}</p>
        </div>
      </div>

      <div className="space-y-3">
        {upcoming.length > 0 ? (
          upcoming.map((event) => {
            const eventDate = resolveEventDate(event.eventDateTime);
            const glyphClass = getEventColorClass(event.id);
            return (
              <div
                key={event.id}
                className="rounded-2xl border border-purple-500/30 bg-purple-900/40 p-3 flex items-start gap-3 shadow-[0_8px_20px_rgba(0,0,0,0.25)]"
              >
                <span className={cn('text-2xl', glyphClass)}>{getEventGlyph(event.id)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white">{event.eventName}</p>
                  <p className="text-sm text-blue-200">{event.description}</p>
                  <p className="text-xs text-blue-300 mt-1">
                    {eventDate ? format(eventDate, 'MMM dd, yyyy · h:mm a') : 'TBA'}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-white/20 p-6 text-center text-sm text-blue-200 bg-white/5">
            No missions scheduled yet. Use the controls below to add one.
          </div>
        )}
      </div>
    </div>
  );
}
