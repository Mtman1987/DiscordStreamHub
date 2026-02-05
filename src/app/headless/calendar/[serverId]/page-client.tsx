'use client';

import * as React from 'react';
import { useSearchParams, useParams } from 'next/navigation';
import { addMonths, startOfMonth, startOfWeek, endOfWeek, endOfMonth, isSameDay, isSameMonth, format } from 'date-fns';
import { FirebaseComponentsProvider } from '@/firebase';
import {
  MissionCalendarCard,
  MissionLogCard,
} from '@/components/mission-calendar-ui';
import { useCollection, useFirestore } from '@/firebase';
import { collection, where, orderBy, query } from 'firebase/firestore';
import { CalendarEvent } from '@/lib/types';

function HeadlessCalendar() {
  const params = useParams();
  const searchParams = useSearchParams();
  const firestore = useFirestore();

  const serverId = params.serverId as string;
  const offset = searchParams.get('monthOffset');
  const monthOffset = offset ? parseInt(offset, 10) : 0;
  const today = React.useMemo(() => new Date(), []);
  const month = React.useMemo(
    () => addMonths(startOfMonth(today), Number.isNaN(monthOffset) ? 0 : monthOffset),
    [today, monthOffset]
  );
  
  const { viewStart, viewEnd } = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return { viewStart: start, viewEnd: end };
  }, [month]);


  const eventsQuery = React.useMemo(() => {
      if (!firestore || !serverId) return null;
      const eventsRef = collection(firestore, 'servers', serverId, 'calendarEvents');
      return query(
        eventsRef,
        where('eventDateTime', '>=', viewStart),
        where('eventDateTime', '<=', viewEnd),
        orderBy('eventDateTime', 'asc')
      );
  }, [firestore, serverId, viewStart, viewEnd]);

  const { data: allEvents } = useCollection<CalendarEvent>(eventsQuery);

  const { calendarEvents, monthCaptains, todaysCaptain, missionEvents } = React.useMemo(() => {
    if (!allEvents) {
      return { calendarEvents: [], monthCaptains: [], todaysCaptain: null, missionEvents: [] as CalendarEvent[] };
    }
    const eventsForMonth = allEvents.filter((event) => {
      if (!event.eventDateTime) return false;
      const date = event.eventDateTime.toDate();
      return date >= viewStart && date <= viewEnd;
    });

    const captainLogs = eventsForMonth.filter((event) => {
      return event.type === 'captains-log' && event.eventDateTime && isSameMonth(event.eventDateTime.toDate(), month);
    });

    const captainsMap = captainLogs.reduce<Record<string, any>>((acc, log) => {
      const key = log.userId || log.username || log.id;
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = {
          username: log.username || 'Captain',
          userAvatar: log.userAvatar,
          count: 0,
        };
      }
      acc[key].count += 1;
      return acc;
    }, {});

    const sortedCaptains = Object.values(captainsMap).sort((a, b) => b.count - a.count);

    const todaysCaptain = allEvents.find(
      (event) => event.type === 'captains-log' && event.eventDateTime && isSameDay(event.eventDateTime.toDate(), today)
    ) || null;

    const upcomingMissions = allEvents
      .filter((event) => event.type !== 'captains-log' && event.eventDateTime)
      .filter((event) => event.eventDateTime!.toDate() >= today);

    return {
      calendarEvents: eventsForMonth,
      monthCaptains: sortedCaptains,
      todaysCaptain,
      missionEvents: upcomingMissions,
    };
  }, [allEvents, month, today, viewStart, viewEnd]);


  return (
    <main className="mission-calendar w-[1200px] h-[900px] bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-950 text-white p-8">
      <div className="flex flex-col gap-6 h-full">
        <MissionCalendarCard
          month={month}
          today={today}
          allEvents={calendarEvents}
          monthCaptains={monthCaptains}
        />
        <MissionLogCard missionEvents={missionEvents} todaysCaptain={todaysCaptain} />
      </div>
    </main>
  );
}


export default function HeadlessCalendarClientPage() {
  return (
    <FirebaseComponentsProvider>
      <HeadlessCalendar />
    </FirebaseComponentsProvider>
  );
}
