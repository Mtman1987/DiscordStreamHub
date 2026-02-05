'use server';

import { db } from '@/firebase/server-init';
import { addMonths, format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth } from 'date-fns';
import puppeteer from 'puppeteer';

export async function generateCalendarImage(
  serverId: string,
  monthOffset: number = 0
): Promise<string | null> {
  try {
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
    
    const sortedCaptains = Array.from(captainStats.values()).sort((a, b) => b.count - a.count);
    const upcomingEvents = events
      .filter(e => e.type !== 'captains-log' && e.eventDateTime && isSameMonth(e.eventDateTime.toDate(), targetMonth))
      .sort((a, b) => a.eventDateTime.toDate().getTime() - b.eventDateTime.toDate().getTime())
      .slice(0, 5);

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
              background: linear-gradient(135deg, #172554 0%, #1e3a8a 50%, #1e1b4b 100%);
              color: white; 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
              padding: 32px;
            }
            .header { margin-bottom: 24px; }
            .subtitle { font-size: 12px; text-transform: uppercase; letter-spacing: 0.3em; color: #bfdbfe; margin-bottom: 4px; }
            .title { font-size: 32px; font-weight: 700; margin-bottom: 4px; }
            .month { font-size: 14px; color: #bfdbfe; }
            .calendar-wrapper { 
              border: 1px solid rgba(255, 255, 255, 0.1); 
              border-radius: 24px; 
              padding: 24px; 
              background: rgba(255, 255, 255, 0.05);
              margin-bottom: 24px;
            }
            .weekdays { 
              display: grid; 
              grid-template-columns: repeat(7, 1fr); 
              text-align: center; 
              font-size: 12px; 
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
              height: 64px;
              background: rgba(255, 255, 255, 0.05);
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .day.today { 
              background: rgba(147, 51, 234, 0.7); 
              border-color: rgba(216, 180, 254, 1);
            }
            .day.other-month { opacity: 0.2; }
            .day-num { font-size: 11px; font-weight: 600; color: #dbeafe; position: absolute; top: 4px; left: 6px; z-index: 1; }
            .captain-avatar { width: 56px; height: 56px; border-radius: 50%; }
            .event-dot { position: absolute; top: 4px; right: 4px; font-size: 20px; z-index: 2; }
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
            .captain-badge-avatar { width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.4); }
            .captain-badge-name { font-size: 13px; font-weight: 600; }
            .captain-badge-count { font-size: 10px; color: #bfdbfe; }
            .events-section { border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 16px; }
            .events-title { font-size: 13px; font-weight: 600; color: #bfdbfe; margin-bottom: 12px; text-transform: uppercase; }
            .event-item { background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; display: flex; gap: 8px; }
            .event-dot-list { width: 8px; height: 8px; background: #fbbf24; border-radius: 50%; margin-top: 4px; }
            .event-name { font-size: 13px; font-weight: 600; color: #dbeafe; }
            .event-time { font-size: 11px; color: #93c5fd; }
          </style>
        </head>
        <body>
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
                    ${dayData?.dayEvents?.length > 0 ? '<div class="event-dot">🟣</div>' : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <div class="captains-section">
            ${sortedCaptains.length > 0 ? sortedCaptains.map(captain => `
              <div class="captain-badge">
                ${captain.userAvatar ? `<img src="${captain.userAvatar}" class="captain-badge-avatar" />` : `<div class="captain-badge-avatar" style="background: #7c3aed; display: flex; align-items: center; justify-content: center; font-weight: bold;">${captain.username.charAt(0)}</div>`}
                <div>
                  <div class="captain-badge-name">${captain.username}</div>
                  <div class="captain-badge-count">${captain.count} day(s)</div>
                </div>
              </div>
            `).join('') : '<div style="font-size: 13px; color: #bfdbfe;">No captains logged this month</div>'}
          </div>
          <div class="events-section">
            <div class="events-title">Upcoming Events</div>
            ${upcomingEvents.length > 0 ? upcomingEvents.map(event => {
              const eventDate = event.eventDateTime.toDate();
              return `
                <div class="event-item">
                  <div class="event-dot-list"></div>
                  <div>
                    <div class="event-name">${event.eventName}</div>
                    <div class="event-time">${format(eventDate, 'MMM d')} at ${format(eventDate, 'h:mm a')}</div>
                  </div>
                </div>
              `;
            }).join('') : '<div style="font-size: 12px; color: #9ca3af; text-align: center; padding: 12px;">No upcoming events</div>'}
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
    
    return `data:image/png;base64,${screenshot.toString('base64')}`;
  } catch (error) {
    console.error(`[generateCalendarImage] Error:`, error);
    return null;
  }
}
