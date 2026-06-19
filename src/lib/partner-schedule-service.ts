'use server';

import { db } from '@/data/server-init';
import { getAppUrl } from '@/lib/runtime-config';

interface TwitchScheduleSegment {
  id: string;
  start_time: string;
  end_time: string;
  title: string;
  category: { name: string } | null;
  is_recurring: boolean;
}

export async function fetchTwitchSchedule(broadcasterId: string, accessToken: string): Promise<TwitchScheduleSegment[]> {
  try {
    const icalUrl = `https://api.twitch.tv/helix/schedule/icalendar?broadcaster_id=${broadcasterId}`;
    const response = await fetch(icalUrl);
    
    if (!response.ok) return [];
    
    const icalData = await response.text();
    const events: TwitchScheduleSegment[] = [];
    const eventBlocks = icalData.split('BEGIN:VEVENT');
    
    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i];
      const summaryMatch = block.match(/SUMMARY:(.+)/);
      const startMatch = block.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
      const endMatch = block.match(/DTEND[^:]*:(\d{8}T\d{6})/);
      const uidMatch = block.match(/UID:(.+)/);
      const isRecurring = block.includes('RRULE');
      
      if (summaryMatch && startMatch && endMatch) {
        events.push({
          id: uidMatch?.[1] || `event_${i}`,
          start_time: parseICalDate(startMatch[1]),
          end_time: parseICalDate(endMatch[1]),
          title: summaryMatch[1].trim(),
          category: null,
          is_recurring: isRecurring
        });
      }
    }
    
    return events.slice(0, 25);
  } catch {
    return [];
  }
}

function parseICalDate(icalDate: string): string {
  // iCal format: 20260307T020000Z
  const year = icalDate.substring(0, 4);
  const month = icalDate.substring(4, 6);
  const day = icalDate.substring(6, 8);
  const hour = icalDate.substring(9, 11);
  const minute = icalDate.substring(11, 13);
  const second = icalDate.substring(13, 15);
  
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

export async function generateScheduleEmbed(
  userId: string,
  serverId: string,
  options: { forceRefresh?: boolean; channelId?: string; messageId?: string } = {}
) {
  const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
  const userData = userDoc.data();
  
  if (!userData?.twitchLogin || !userData?.twitchId) {
    return null;
  }

  const username = userData.twitchLogin;
  const broadcasterId = userData.twitchId;
  const forceRefresh = options.forceRefresh ?? false;
  
  const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents');
  let imageUrl: string | null = null;

  if (!forceRefresh) {
    const fs = await import('fs/promises');
    const path = await import('path');
    const userCalendarDir = path.join('/data/clips', username, 'calendar');

    try {
      const files = await fs.readdir(userCalendarDir);
      const pngFiles = files.filter(f => f.endsWith('.png')).sort().reverse();
      if (pngFiles.length > 0) {
        imageUrl = `${getAppUrl()}/api/media/${username}/calendar/${pngFiles[0]}`;
        console.log('[PartnerSchedule] Using existing calendar:', imageUrl);
      }
    } catch (readError) {
      console.log('[PartnerSchedule] No existing calendar found, will generate new one');
    }
  }

  if (!imageUrl) {
    const segments = await fetchTwitchSchedule(broadcasterId, '');
    const batch = db.batch();
    const oldEvents = await eventsRef.get();
    oldEvents.docs.forEach((doc: { ref: any }) => batch.delete(doc.ref));

    segments.forEach(seg => {
      const docRef = eventsRef.doc();
      batch.set(docRef, {
        eventName: seg.title,
        description: 'Twitch Stream',
        eventDateTime: new Date(seg.start_time),
        type: 'stream',
        isRecurring: seg.is_recurring
      });
    });

    await batch.commit();

    imageUrl = await generatePartnerCalendarImage(userId, serverId);
  }
  
  if (!imageUrl) {
    console.error('[PartnerSchedule] Failed to generate image');
    return null;
  }

  const embed = {
    embeds: [{
      title: `📅 ${username}'s Stream Schedule`,
      image: { url: imageUrl },
      color: 0x9146FF,
      footer: { text: 'Twitch Schedule • Times in CT' },
      timestamp: new Date().toISOString()
    }],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: '🔄 Refresh',
            custom_id: `partner_schedule_refresh_${userId}_${serverId}`
          },
          {
            type: 2,
            style: 1,
            label: '➕ Add Event',
            custom_id: `partner_schedule_add_${userId}_${serverId}`
          },
          {
            type: 2,
            style: 2,
            label: '📆 Sync Google',
            custom_id: `partner_schedule_seturl_${userId}_${serverId}`
          }
        ]
      }
    ]
  };

  console.log('[PartnerSchedule] Generated embed with components:', JSON.stringify(embed.components));
  return embed;
}

async function generatePartnerCalendarImage(userId: string, serverId: string): Promise<string | null> {
  try {
    const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
    const userData = userDoc.data();
    const username = userData?.twitchLogin || 'Streamer';
    const avatar = userData?.twitchProfileImageUrl;

    const eventsSnapshot = await db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents').get();
    const events = eventsSnapshot.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }));

    const month = new Date();
    const now = new Date();
    
    // Process recurring events
    const processedEvents = events.flatMap((event: any) => {
      if (event.isRecurring && event.eventDateTime) {
        const originalDate = event.eventDateTime.toDate();
        const dayOfWeek = originalDate.getDay();
        const hours = originalDate.getHours();
        const minutes = originalDate.getMinutes();
        const firstOccurrence = new Date(now);
        firstOccurrence.setHours(hours, minutes, 0, 0);
        let firstOffsetDays = (dayOfWeek - now.getDay() + 7) % 7;
        if (firstOffsetDays === 0 && firstOccurrence <= now) {
          firstOffsetDays = 7;
        }
        
        const occurrences = [];
        for (let i = 0; i < 8; i++) {
          const daysUntilNext = firstOffsetDays + i * 7;
          const nextDate = new Date(now);
          nextDate.setDate(now.getDate() + daysUntilNext);
          nextDate.setHours(hours, minutes, 0, 0);
          occurrences.push({ ...event, eventDateTime: nextDate });
        }
        return occurrences;
      }
      return [{ ...event, eventDateTime: event.eventDateTime?.toDate?.() || event.eventDateTime }];
    });

    const { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, isSameMonth } = await import('date-fns');
    const viewStart = startOfWeek(startOfMonth(month));
    const viewEnd = endOfWeek(endOfMonth(month));

    const cells: Date[] = [];
    let cursor = new Date(viewStart);
    while (cursor <= viewEnd) {
      cells.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const eventsByDay = new Map();
    processedEvents.forEach((event: any) => {
      if (!event.eventDateTime) return;
      const key = format(event.eventDateTime, 'yyyy-MM-dd');
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key).push(event);
    });

    const upcomingStreams = (() => {
      const uniqueDates = new Map<string, any>();
      processedEvents
        .filter((e: any) => e.eventDateTime >= now)
        .sort((a: any, b: any) => a.eventDateTime.getTime() - b.eventDateTime.getTime())
        .forEach((e: any) => {
          const dateKey = format(e.eventDateTime, 'yyyy-MM-dd-HH-mm');
          if (!uniqueDates.has(dateKey)) {
            uniqueDates.set(dateKey, e);
          }
        });
      return Array.from(uniqueDates.values()).slice(0, 5);
    })();

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 1200px; height: 900px; background: linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #312e81 100%); color: white; font-family: -apple-system, sans-serif; padding: 32px; }
.header { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.2); margin-bottom: 24px; }
.avatar { width: 64px; height: 64px; border-radius: 50%; border: 2px solid #a78bfa; }
.title { font-size: 32px; font-weight: 700; }
.subtitle { font-size: 16px; color: #c4b5fd; }
.grid { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; }
.calendar { border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; background: rgba(255,255,255,0.05); }
.weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 14px; color: #c4b5fd; margin-bottom: 16px; font-weight: 600; }
.days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
.day { border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; height: 80px; background: rgba(255,255,255,0.05); font-size: 14px; font-weight: 600; }
.day.today { background: rgba(147,51,234,0.5); border-color: #a78bfa; }
.day.other-month { opacity: 0.3; }
.day.has-event { background: rgba(168,85,247,0.3); border-color: #a78bfa; }
.day-times { font-size: 11px; color: #c4b5fd; margin-top: 4px; }
.upcoming { border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; background: rgba(255,255,255,0.05); }
.upcoming-title { font-size: 20px; font-weight: 700; color: #c4b5fd; margin-bottom: 16px; }
.stream { background: rgba(168,85,247,0.3); border: 1px solid rgba(168,85,247,0.5); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.stream-name { font-weight: 600; font-size: 14px; }
.stream-time { font-size: 12px; color: #c4b5fd; margin-top: 4px; }
.footer { text-align: center; font-size: 12px; color: #c4b5fd; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 16px; margin-top: 24px; }
</style></head><body>
<div class="header">
  ${avatar ? `<img src="${avatar}" class="avatar" />` : ''}
  <div><div class="title">${username}'s Stream Schedule</div><div class="subtitle">${format(month, 'MMMM yyyy')}</div></div>
</div>
<div class="grid">
  <div class="calendar">
    <div class="weekdays"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div>
    <div class="days">
      ${cells.map(date => {
        const key = format(date, 'yyyy-MM-dd');
        const dayEvents = eventsByDay.get(key) || [];
        const isCurrentMonth = isSameMonth(date, month);
        const isToday = isSameDay(date, now);
        return `<div class="day ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'other-month' : ''} ${dayEvents.length > 0 ? 'has-event' : ''}">
          <div>${date.getDate()}</div>
          ${dayEvents.length > 0 ? `<div class="day-times">${dayEvents.slice(0, 2).map((e: any) => format(e.eventDateTime, 'h:mm a')).join('<br>')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>
  <div class="upcoming">
    <div class="upcoming-title">Upcoming Streams</div>
    ${upcomingStreams.length > 0 ? upcomingStreams.map((e: any) => `
      <div class="stream">
        <div class="stream-name">${e.eventName}</div>
        <div class="stream-time">${format(e.eventDateTime, 'MMM dd · h:mm a')}</div>
        ${e.isRecurring ? '<div class="stream-time">🔄 Recurring</div>' : ''}
      </div>
    `).join('') : '<div style="text-align: center; color: #c4b5fd; padding: 32px;">No upcoming streams</div>'}
  </div>
</div>
<div class="footer">Schedule synced from Twitch · Times in CT</div>
</body></html>`;

    const puppeteer = (await import('puppeteer')).default;
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    let screenshot: Buffer;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 900 });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      screenshot = Buffer.from(await page.screenshot({ type: 'png' }));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    const fs = await import('fs/promises');
    const path = await import('path');
    const userCalendarDir = path.join('/data/clips', username, 'calendar');
    
    await fs.mkdir(userCalendarDir, { recursive: true });

    try {
      const files = await fs.readdir(userCalendarDir);
      for (const file of files) {
        if (file.endsWith('.png')) {
          await fs.unlink(path.join(userCalendarDir, file));
        }
      }
    } catch (cleanupError) {
      console.log('[PartnerCalendar] Cleanup skipped:', cleanupError);
    }

    const fileName = `calendar-${Date.now()}.png`;
    const filePath = path.join(userCalendarDir, fileName);

    await fs.writeFile(filePath, screenshot);

    const publicUrl = `${getAppUrl()}/api/media/${username}/calendar/${fileName}`;
    console.log('[PartnerCalendar] Image saved to volume:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('[PartnerCalendar] Error generating image:', error);
    return null;
  }
}

function generateCalendarGrid(year: number, month: number): string {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  let calendar = 'Su Mo Tu We Th Fr Sa\n';
  let day = 1;
  
  for (let week = 0; week < 6; week++) {
    let weekStr = '';
    for (let dow = 0; dow < 7; dow++) {
      if ((week === 0 && dow < firstDay) || day > daysInMonth) {
        weekStr += '   ';
      } else {
        weekStr += day.toString().padStart(2, ' ') + ' ';
        day++;
      }
    }
    calendar += weekStr.trimEnd() + '\n';
    if (day > daysInMonth) break;
  }
  
  return calendar;
}

export async function savePartnerScheduleThread(userId: string, serverId: string, threadId: string, channelId: string) {
  await db.collection('servers').doc(serverId).collection('users').doc(userId).update({
    scheduleThreadId: threadId,
    scheduleChannelId: channelId,
    scheduleLastUpdated: new Date()
  });
}

export async function addCustomEvent(userId: string, serverId: string, eventName: string, eventDate: string, eventTime: string, eventDescription: string) {
  const eventDoc = {
    name: eventName,
    date: eventDate,
    time: eventTime,
    description: eventDescription,
    createdAt: new Date(),
    createdBy: userId
  };

  await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('customEvents').add(eventDoc);
}

export async function getCustomEvents(userId: string, serverId: string) {
  const snapshot = await db.collection('servers').doc(serverId)
    .collection('users').doc(userId)
    .collection('customEvents')
    .orderBy('date', 'asc')
    .limit(10)
    .get();

  return snapshot.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }));
}
