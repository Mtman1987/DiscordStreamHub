'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { startOfMonth } from 'date-fns';
import { FirebaseComponentsProvider } from '@/firebase';
import { PartnerCalendar } from '@/components/partner-calendar-ui';
import { useDoc, useFirestore } from '@/firebase';
import { doc, collection, onSnapshot } from 'firebase/firestore';

function PartnerScheduleCalendar() {
  const params = useParams();
  const firestore = useFirestore();

  const userId = params.userId as string;
  const serverId = params.serverId as string;
  
  const userDocRef = React.useMemo(() => {
    if (!firestore || !serverId || !userId) return null;
    return doc(firestore, 'servers', serverId, 'users', userId);
  }, [firestore, serverId, userId]);

  const { data: userData } = useDoc(userDocRef);

  const [scheduleEvents, setScheduleEvents] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (!firestore || !serverId || !userId) return;

    const eventsRef = collection(firestore, 'servers', serverId, 'users', userId, 'scheduleEvents');
    const unsubscribe = onSnapshot(eventsRef, (snapshot) => {
      const events = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setScheduleEvents(events);
    });

    return () => unsubscribe();
  }, [firestore, serverId, userId]);

  const today = React.useMemo(() => new Date(), []);
  const month = React.useMemo(() => startOfMonth(today), [today]);
  
  const processedEvents = React.useMemo(() => {
    const now = new Date();
    return scheduleEvents.flatMap(event => {
      if (event.isRecurring && event.eventDateTime) {
        const originalDate = event.eventDateTime.toDate();
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
    <FirebaseComponentsProvider>
      <PartnerScheduleCalendar />
    </FirebaseComponentsProvider>
  );
}
