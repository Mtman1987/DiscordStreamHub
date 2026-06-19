'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { startOfMonth } from 'date-fns';
import { DataComponentsProvider } from '@/data';
import { PartnerCalendar } from '@/components/partner-calendar-ui';
import { useDoc, useDataStore } from '@/data';
import { doc, collection, onSnapshot } from '@/lib/data-shim';
import { timestampToDate } from '@/lib/date-utils';

function PartnerScheduleCalendar() {
  const params = useParams();
  const store = useDataStore();

  const userId = params.userId as string;
  const serverId = params.serverId as string;
  
  const userDocRef = React.useMemo(() => {
    if (!store || !serverId || !userId) return null;
    return doc(store, 'servers', serverId, 'users', userId);
  }, [store, serverId, userId]);

  const { data: userData } = useDoc(userDocRef);

  const [scheduleEvents, setScheduleEvents] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (!store || !serverId || !userId) return;

    const eventsRef = collection(store, 'servers', serverId, 'users', userId, 'scheduleEvents');
    const unsubscribe = onSnapshot(eventsRef, (snapshot) => {
      const events = snapshot.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({
        id: doc.id,
        ...doc.data()
      }));
      setScheduleEvents(events);
    });

    return () => unsubscribe();
  }, [store, serverId, userId]);

  const today = React.useMemo(() => new Date(), []);
  const month = React.useMemo(() => startOfMonth(today), [today]);
  
  const processedEvents = React.useMemo(() => {
    const now = new Date();
    return scheduleEvents.flatMap(event => {
      if (event.isRecurring && event.eventDateTime) {
        const originalDate = timestampToDate(event.eventDateTime);
        if (!originalDate) return [];
        const dayOfWeek = originalDate.getDay();
        const hours = originalDate.getHours();
        const minutes = originalDate.getMinutes();
        
        const occurrences = [];
        for (let i = 0; i < 8; i++) {
          const daysUntilNext = (dayOfWeek - now.getDay() + 7 * i) % 7 + 7 * Math.floor(i / 7);
          const nextDate = new Date(now);
          nextDate.setDate(now.getDate() + daysUntilNext);
          nextDate.setHours(hours, minutes, 0, 0);
          
          occurrences.push({
            ...event,
            id: `${event.id}_${nextDate.getTime()}`,
            eventDateTime: { toDate: () => new Date(nextDate) }
          });
        }
        return occurrences;
      }
      return [event];
    });
  }, [scheduleEvents]);

  const username = userData?.twitchLogin || 'Streamer';
  const avatar = userData?.twitchProfileImageUrl;

  return (
    <PartnerCalendar 
      month={month}
      events={processedEvents}
      username={username}
      avatar={avatar}
    />
  );
}

export default function PartnerScheduleClientPage() {
  return (
    <DataComponentsProvider>
      <PartnerScheduleCalendar />
    </DataComponentsProvider>
  );
}
