/* eslint-disable @next/next/no-img-element */
import * as React from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameDay,
  isSameMonth,
} from 'date-fns';

interface CalendarEvent {
  id: string;
  eventName: string;
  eventDateTime: string; // ISO string
  description: string;
  type: 'event' | 'meeting' | 'qotd' | 'captains-log';
  userId: string;
  userAvatar: string;
  username: string;
}

interface CalendarImageTemplateProps {
  events: CalendarEvent[];
  targetMonth: Date;
  today: Date;
}

export function CalendarImageTemplate({
  events,
  targetMonth,
  today,
}: CalendarImageTemplateProps) {
  const viewStart = startOfWeek(startOfMonth(targetMonth));
  const viewEnd = endOfWeek(endOfMonth(targetMonth));

  const eventsByDay = new Map<string, { captainsLog: CalendarEvent | null; dayEvents: CalendarEvent[] }>();
  events.forEach((event) => {
    const eventDate = new Date(event.eventDateTime);
    const key = format(eventDate, 'yyyy-MM-dd');
    if (!eventsByDay.has(key)) {
      eventsByDay.set(key, { captainsLog: null, dayEvents: [] });
    }
    const bucket = eventsByDay.get(key)!;
    if (event.type === 'captains-log') {
      bucket.captainsLog = event;
    } else {
      bucket.dayEvents.push(event);
    }
  });

  const monthCaptains = Array.from(
    events
      .filter((e) => e.type === 'captains-log' && isSameMonth(new Date(e.eventDateTime), targetMonth))
      .reduce((acc, log) => {
        const entry = acc.get(log.userId) || { ...log, count: 0 };
        entry.count++;
        acc.set(log.userId, entry);
        return acc;
      }, new Map<string, CalendarEvent & { count: number }>())
      .values()
  ).sort((a, b) => b.count - a.count);

  const cells: Date[] = [];
  let cursor = new Date(viewStart);
  while (cursor <= viewEnd) {
    cells.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        padding: '24px',
        backgroundColor: '#1a202c',
        color: 'white',
        fontFamily: '"Inter", sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.025em' }}>Calendar</div>
          <div style={{ fontSize: '18px', color: '#a0aec0' }}>{format(targetMonth, 'MMMM yyyy')}</div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, border: '1px solid #4a5568', borderRadius: '12px', padding: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: '12px', color: '#718096', marginBottom: '8px' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', flexGrow: 1 }}>
          {cells.map((cellDate) => {
            const key = format(cellDate, 'yyyy-MM-dd');
            const dayData = eventsByDay.get(key);
            const isCurrentMonth = isSameMonth(cellDate, targetMonth);
            const isTodayFlag = isSameDay(cellDate, today);

            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  border: '1px solid #2d3748',
                  borderRadius: '8px',
                  backgroundColor: isTodayFlag ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                  opacity: isCurrentMonth ? 1 : 0.4,
                  padding: '4px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{format(cellDate, 'd')}</div>
                {dayData?.captainsLog?.userAvatar && (
                  <img
                    src={dayData.captainsLog.userAvatar}
                    alt="captain"
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: '4px',
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      border: '2px solid #fbbF24',
                    }}
                  />
                )}
                {dayData && dayData.dayEvents.length > 0 && (
                   <div style={{ position: 'absolute', top: '4px', right: '4px', fontSize: '16px' }}>⭐</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #4a5568' }}>
        <div style={{ fontSize: '14px', marginRight: '12px', color: '#a0aec0' }}>Month's Captains:</div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {monthCaptains.slice(0, 5).map((c, i) => (
             <div key={c.userId} style={{ display: 'flex', alignItems: 'center', marginLeft: i > 0 ? '-10px' : '0' }}>
              <img src={c.userAvatar} alt={c.username} style={{ width: '36px', height: '36px', borderRadius: '50%', border: '2px solid #1a202c' }}/>
            </div>
          ))}
          {monthCaptains.length > 5 && (
            <div style={{ marginLeft: '8px', fontSize: '12px', color: '#a0aec0' }}>+{monthCaptains.length - 5} more</div>
          )}
        </div>
      </div>
    </div>
  );
}
