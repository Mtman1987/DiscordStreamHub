'use server';

import { db } from '@/firebase/server-init';
import { addMonths, format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth } from 'date-fns';
import puppeteer from 'puppeteer';

export async function generateCalendarImage(
  serverId: string,
  monthOffset: number = 0
): Promise<string | null> {
  try {
    console.log(`[generateCalendarImage] Generating calendar for server ${serverId}, offset ${monthOffset}`);
    
    const eventsSnapshot = await db.collection('servers').doc(serverId)
      .collection('calendarEvents')
      .orderBy('eventDateTime', 'asc')
      .get();
    
    const events = eventsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    const targetMonth = addMonths(new Date(), monthOffset);
    const today = new Date();
    const viewStart = startOfWeek(startOfMonth(targetMonth));
    const viewEnd = endOfWeek(endOfMonth(targetMonth));

    const cells: Date[] = [];
    let cursor = new Date(viewStart);
    while (cursor <= viewEnd) {
      cells.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const eventsByDay = new Map();
    const captainStats = new Map();
    
    events.forEach((event) => {
      if (!event.eventDateTime) return;
      const eventDate = event.eventDateTime.toDate();
      const key = format(eventDate, 'yyyy-MM-dd');
      if (!eventsByDay.has(key)) {
        eventsByDay.set(key, { captainsLog: null, dayEvents: [] });
      }
      const bucket = eventsByDay.get(key);
      if (event.type === 'captains-log') {
        bucket.captainsLog = event;
        
        // Track captain stats for the month
        if (isSameMonth(eventDate, targetMonth)) {
          const captainKey = event.userId || event.username || event.id;
          if (!captainStats.has(captainKey)) {
            captainStats.set(captainKey, {
              username: event.username || 'Captain',
              userAvatar: event.userAvatar,
              count: 0
            });
          }
          captainStats.get(captainKey).count++;
        }
      } else {
        bucket.dayEvents.push(event);
      }
    });
    
    const sortedCaptains = Array.from(captainStats.values())
      .sort((a, b) => b.count - a.count);
    
    // Get upcoming events (non-captain-log events)
    console.log(`[generateCalendarImage] Total events fetched: ${events.length}`);
    console.log(`[generateCalendarImage] Target month: ${format(targetMonth, 'MMMM yyyy')}`);
    
    const upcomingEvents = events
      .filter(e => {
        const isNotCaptainLog = e.type !== 'captains-log';
        const hasDateTime = !!e.eventDateTime;
        console.log(`  Event: ${e.eventName}, type: ${e.type}, hasDateTime: ${hasDateTime}`);
        return isNotCaptainLog && hasDateTime;
      })
      .filter(e => {
        const eventDate = e.eventDateTime.toDate();
        const inMonth = isSameMonth(eventDate, targetMonth);
        console.log(`    ${e.eventName}: ${format(eventDate, 'MMM d, yyyy h:mm a')} - inMonth: ${inMonth}`);
        return inMonth;
      })
      .sort((a, b) => a.eventDateTime.toDate().getTime() - b.eventDateTime.toDate().getTime())
      .slice(0, 5);
    
    console.log(`[generateCalendarImage] Found ${upcomingEvents.length} events for ${format(targetMonth, 'MMMM yyyy')}`);
    upcomingEvents.forEach(e => {
      console.log(`  - ${e.eventName} on ${format(e.eventDateTime.toDate(), 'MMM d, yyyy h:mm a')}`);
    });

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              width: 1200px; 
              height: 900px; 
              background: linear-gradient(135deg, #0d1c4d 0%, #0f245f 50%, #070c1f 100%);
              color: white; 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
              padding: 32px;
              position: relative;
            }
            body::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background-image: 
                radial-gradient(2px 2px at 20% 30%, rgba(147, 197, 253, 0.3), transparent),
                radial-gradient(2px 2px at 60% 70%, rgba(147, 197, 253, 0.2), transparent),
                radial-gradient(1px 1px at 50% 50%, rgba(147, 197, 253, 0.3), transparent),
                radial-gradient(1px 1px at 80% 10%, rgba(147, 197, 253, 0.2), transparent),
                radial-gradient(2px 2px at 90% 60%, rgba(147, 197, 253, 0.3), transparent),
                radial-gradient(1px 1px at 33% 80%, rgba(147, 197, 253, 0.2), transparent);
              background-size: 200% 200%;
              pointer-events: none;
              z-index: 0;
            }
            .container { position: relative; z-index: 1; }
            .header { margin-bottom: 20px; }
            .subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: 0.3em; color: #bfdbfe; margin-bottom: 4px; }
            .title { font-size: 32px; font-weight: 700; margin-bottom: 2px; }
            .month { font-size: 14px; color: #bfdbfe; }
            .calendar-wrapper { 
              border: 1px solid rgba(255, 255, 255, 0.1); 
              border-radius: 16px; 
              padding: 16px; 
              background: rgba(255, 255, 255, 0.05);
              margin-bottom: 20px;
            }
            .weekdays { 
              display: grid; 
              grid-template-columns: repeat(7, 1fr); 
              text-align: center; 
              font-size: 11px; 
              color: #bfdbfe; 
              margin-bottom: 12px; 
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }
            .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
            .day { 
              border: 1px solid rgba(255, 255, 255, 0.05); 
              border-radius: 12px; 
              padding: 4px; 
              position: relative; 
              min-height: 72px;
              background: rgba(255, 255, 255, 0.05);
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .day.today { 
              background: rgba(147, 51, 234, 0.7); 
              border-color: rgba(216, 180, 254, 1);
              box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
            }
            .day.other-month { opacity: 0.2; }
            .day-num { font-size: 11px; font-weight: 600; color: #dbeafe; position: absolute; top: 4px; left: 6px; z-index: 1; }
            .captain-avatar { 
              width: 56px; 
              height: 56px; 
              border-radius: 50%;
            }
            .event-star { 
              position: absolute; 
              top: 4px; 
              right: 4px; 
              width: 16px;
              height: 16px;
              background: #fbbf24;
              border-radius: 50%;
              z-index: 2;
            }
            .captains-section {
              border-top: 1px solid rgba(255, 255, 255, 0.1);
              padding-top: 16px;
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              margin-bottom: 16px;
            }
            .captain-badge {
              display: flex;
              align-items: center;
              gap: 8px;
              background: rgba(255, 255, 255, 0.1);
              border-radius: 20px;
              padding: 4px 12px 4px 4px;
            }
            .captain-badge-avatar {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              border: 1px solid rgba(255, 255, 255, 0.4);
            }
            .captain-badge-info {
              display: flex;
              flex-direction: column;
            }
            .captain-badge-name {
              font-size: 13px;
              font-weight: 600;
              line-height: 1.2;
            }
            .captain-badge-count {
              font-size: 10px;
              color: #bfdbfe;
              line-height: 1.2;
            }
            .no-captains {
              font-size: 13px;
              color: #bfdbfe;
            }
            .events-section {
              border-top: 1px solid rgba(255, 255, 255, 0.1);
              padding-top: 16px;
            }
            .events-title {
              font-size: 13px;
              font-weight: 600;
              color: #bfdbfe;
              margin-bottom: 12px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }
            .event-item {
              background: rgba(255, 255, 255, 0.05);
              border-radius: 8px;
              padding: 8px 12px;
              margin-bottom: 8px;
              display: flex;
              gap: 8px;
              align-items: flex-start;
            }
            .event-dot {
              width: 8px;
              height: 8px;
              background: #fbbf24;
              border-radius: 50%;
              margin-top: 4px;
              flex-shrink: 0;
            }
            .event-content {
              flex: 1;
            }
            .event-name {
              font-size: 13px;
              font-weight: 600;
              color: #dbeafe;
              margin-bottom: 2px;
            }
            .event-time {
              font-size: 11px;
              color: #93c5fd;
            }
            .no-events {
              font-size: 12px;
              color: #9ca3af;
              text-align: center;
              padding: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="subtitle">Mission Calendar</div>
              <div class="title">${format(targetMonth, 'MMMM yyyy')}</div>
              <div class="month">Fleet operations schedule</div>
            </div>
            <div class="calendar-wrapper">
              <div class="weekdays">
                <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
              </div>
              <div class="days">
                ${cells.map(cellDate => {
                  const key = format(cellDate, 'yyyy-MM-dd');
                  const dayData = eventsByDay.get(key);
                  const isCurrentMonth = isSameMonth(cellDate, targetMonth);
                  const isTodayFlag = isSameDay(cellDate, today);
                  return `
                    <div class="day ${isTodayFlag ? 'today' : ''} ${!isCurrentMonth ? 'other-month' : ''}">
                      <div class="day-num">${format(cellDate, 'd')}</div>
                      ${dayData?.captainsLog?.userAvatar ? `<img src="${dayData.captainsLog.userAvatar}" class="captain-avatar" />` : ''}
                      ${dayData?.dayEvents?.length > 0 ? '<div class="event-star"></div>' : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
            <div class="captains-section">
              ${sortedCaptains.length > 0 ? sortedCaptains.map(captain => `
                <div class="captain-badge">
                  ${captain.userAvatar 
                    ? `<img src="${captain.userAvatar}" class="captain-badge-avatar" />` 
                    : `<div class="captain-badge-avatar" style="background: #7c3aed; display: flex; align-items: center; justify-content: center; font-weight: bold;">${captain.username.charAt(0)}</div>`
                  }
                  <div class="captain-badge-info">
                    <div class="captain-badge-name">${captain.username}</div>
                    <div class="captain-badge-count">${captain.count} day(s)</div>
                  </div>
                </div>
              `).join('') : '<div class="no-captains">No captains have logged days this month.</div>'}
            </div>
            <div class="events-section">
              <div class="events-title">Upcoming Events</div>
              ${upcomingEvents.length > 0 ? upcomingEvents.map(event => {
                const eventDate = event.eventDateTime.toDate();
                const dateStr = format(eventDate, 'MMM d');
                const timeStr = format(eventDate, 'h:mm a');
                return `
                  <div class="event-item">
                    <div class="event-dot"></div>
                    <div class="event-content">
                      <div class="event-name">${event.eventName}</div>
                      <div class="event-time">${dateStr} at ${timeStr}</div>
                    </div>
                  </div>
                `;
              }).join('') : '<div class="no-events">No upcoming events scheduled</div>'}
            </div>
          </div>
        </body>
      </html>
    `;
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const screenshot = await page.screenshot({ type: 'png' });
    await browser.close();
    
    const base64 = Buffer.from(screenshot).toString('base64');
    console.log(`[generateCalendarImage] Successfully generated calendar image`);
    
    return `data:image/png;base64,${base64}`;
    
  } catch (error) {
    console.error(`[generateCalendarImage] Error:`, error);
    return null;
  }
}
