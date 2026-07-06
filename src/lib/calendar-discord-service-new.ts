import { addMonths, format } from 'date-fns';
import { db } from '@/data/server-init';
import { generateCalendarImage } from '@/ai/flows/generate-calendar-image';

type CalendarMessageMeta = {
  channelId: string;
  messageId: string;
  includeButtons?: boolean;
  lastUpdated?: Date;
  monthOffset?: number;
};

type CalendarDiscordEvent = {
  id: string;
  type?: string;
  eventName?: string;
  description?: string;
  eventDateTime?: unknown;
};

type DatedCalendarEvent = {
  event: CalendarDiscordEvent;
  date: Date | null;
};

function ensureBotToken() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not configured');
  }
  return token;
}

function getEventColorEmoji(eventId: string) {
  const colors = ['🟣', '🔵', '🟢', '🟡', '💗', '🟠'];
  const hash = eventId.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return colors[Math.abs(hash) % colors.length];
}

function resolveEventDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
    const millis = value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1_000_000);
    return new Date(millis);
  }
  return null;
}

type CaptainHighlight = {
  username: string;
  avatarUrl?: string | null;
};

async function getTodaysCaptain(serverId: string): Promise<CaptainHighlight | null> {
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const snapshot = await db
    .collection('servers')
    .doc(serverId)
    .collection('calendarEvents')
    .where('type', '==', 'captains-log')
    .limit(25)
    .get();

  const captainDoc = snapshot.docs.find((doc: { data: () => Record<string, unknown> }) => doc.data()?.dayKey === todayKey);
  if (!captainDoc) {
    return null;
  }

  const data = captainDoc.data();
  return {
    username: data.username || 'Captain',
    avatarUrl: data.userAvatar || null,
  };
}

export async function buildMissionLogEmbed(serverId: string) {
  const eventsRef = db.collection('servers').doc(serverId).collection('calendarEvents');
  const snapshot = await eventsRef.orderBy('eventDateTime', 'asc').limit(50).get();
  const events: CalendarDiscordEvent[] = snapshot.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const upcomingEvents = events
    .filter((event) => event.type !== 'captains-log')
    .map((event): DatedCalendarEvent => ({ event, date: resolveEventDate(event.eventDateTime) }))
    .filter((entry): entry is DatedCalendarEvent & { date: Date } => !!entry.date && entry.date >= todayStart)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6);

  const description = upcomingEvents.length > 0
    ? upcomingEvents
        .map(({ event, date }) =>
          `${getEventColorEmoji(event.id)} **${event.eventName ?? 'Mission'}**\n${event.description ?? 'Details coming soon.'}\n📅 ${format(date, 'MMM dd, yyyy - h:mm a')}`
        )
        .join('\n\n')
    : '🛰️ No missions scheduled yet.\nUse the buttons below to add missions or sign up for captain\'s log!';

  return {
    title: '🌌 Mission Log',
    description,
    color: 0x9333EA,
    timestamp: new Date().toISOString(),
  };
}

export function buildCalendarEmbed(todaysCaptain?: CaptainHighlight | null) {
  const title = todaysCaptain
    ? `📅 Mission Calendar — ${todaysCaptain.username}`
    : '📅 Space Mountain Mission Calendar';
  const description = todaysCaptain
    ? `👩✈️ Today's Captain: **${todaysCaptain.username}**\nCurrent month fleet operations and captain assignments`
    : 'Current month fleet operations and captain assignments';

  const embed: Record<string, any> = {
    title,
    description,
    image: { url: 'attachment://calendar.png' },
    color: 0x7C3AED,
    timestamp: new Date().toISOString(),
  };

  if (todaysCaptain?.avatarUrl) {
    embed.thumbnail = { url: todaysCaptain.avatarUrl };
  }

  return embed;
}

export function buildCalendarButtons(serverId: string) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "Captain's Log",
          custom_id: `calendar_captain_log_${serverId}`,
          emoji: { name: '📘' },
        },
        {
          type: 2,
          style: 1,
          label: 'Add Mission',
          custom_id: `calendar_add_mission_${serverId}`,
          emoji: { name: '🚀' },
        },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: '⟵ Prev Month',
          custom_id: `calendar_prev_month_${serverId}`,
        },
        {
          type: 2,
          style: 2,
          label: 'Next Month ⟶',
          custom_id: `calendar_next_month_${serverId}`,
        },
      ],
    },
  ];
}

export async function storeCalendarMessageMeta(serverId: string, meta: CalendarMessageMeta) {
  const serverRef = db.collection('servers').doc(serverId);
  const serverDoc = await serverRef.get();
  const existingMeta = serverDoc.data()?.calendarMessages || [];
  
  const updatedMeta = [...existingMeta, {
    ...meta,
    lastUpdated: new Date(),
  }];
  
  await serverRef.set({
    calendarMessages: updatedMeta,
  }, { merge: true });
}

async function sendDiscordMessageWithAttachment(channelId: string, embeds: any[], components: any[], imageBuffer: Buffer, botToken: string) {
  console.log('[CalendarPost] Preparing to send message to channel:', channelId);
  console.log('[CalendarPost] Image buffer size:', imageBuffer.length);
  console.log('[CalendarPost] Embeds count:', embeds.length);
  
  const FormData = require('form-data');
  const form = new FormData();
  
  form.append('payload_json', JSON.stringify({ embeds, components }));
  form.append('files[0]', imageBuffer, { filename: 'calendar.png', contentType: 'image/png' });

  console.log('[CalendarPost] Sending to Discord API...');
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      ...form.getHeaders(),
    },
    body: form.getBuffer(),
  });

  console.log('[CalendarPost] Response status:', response.status);
  return response;
}

async function updateDiscordMessageWithAttachment(channelId: string, messageId: string, embeds: any[], components: any[], imageBuffer: Buffer, botToken: string) {
  const FormData = require('form-data');
  const form = new FormData();
  
  form.append('payload_json', JSON.stringify({ embeds, components }));
  form.append('files[0]', imageBuffer, { filename: 'calendar.png', contentType: 'image/png' });

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bot ${botToken}`,
      ...form.getHeaders(),
    },
    body: form.getBuffer(),
  });

  return response;
}

export async function refreshCalendarMessage(serverId: string) {
  const serverDoc = await db.collection('servers').doc(serverId).get();
  const calendars = serverDoc.data()?.calendarMessages as CalendarMessageMeta[] | undefined;

  if (!calendars || calendars.length === 0) {
    console.warn(`[CalendarRefresh] No stored Discord metadata for server ${serverId}`);
    return { success: false, message: 'No calendar messages found' };
  }

  const botToken = ensureBotToken();
  const updatedCalendars: CalendarMessageMeta[] = [];

  for (const meta of calendars) {
    const monthOffset = meta.monthOffset ?? 0;
    const calendarImage = await generateCalendarImage(serverId, monthOffset);
    if (!calendarImage) continue;

    const base64Data = calendarImage.replace(/^data:image\/png;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const missionEmbed = await buildMissionLogEmbed(serverId);
    const todaysCaptain = await getTodaysCaptain(serverId);
    const calendarEmbed = buildCalendarEmbed(todaysCaptain);

    const components = meta.includeButtons ?? true ? buildCalendarButtons(serverId) : [];

    const response = await updateDiscordMessageWithAttachment(
      meta.channelId,
      meta.messageId,
      [missionEmbed, calendarEmbed],
      components,
      imageBuffer,
      botToken
    );

    if (response.ok) {
      updatedCalendars.push({
        ...meta,
        monthOffset,
        lastUpdated: new Date(),
      });
    } else if (response.status === 404) {
      console.log(`[CalendarRefresh] Message ${meta.messageId} not found, removing from list`);
    } else {
      const errorText = await response.text();
      console.error(`[CalendarRefresh] Discord error for ${meta.messageId}:`, response.status, errorText);
      updatedCalendars.push(meta);
    }
  }

  await db.collection('servers').doc(serverId).set({
    calendarMessages: updatedCalendars,
  }, { merge: true });

  return { success: true, updated: updatedCalendars.length };
}

export async function postCalendarToDiscord(serverId: string, channelId: string, monthOffset = 0) {
  console.log(`[CalendarPost] Starting post for server ${serverId} to channel ${channelId}`);
  const calendarImage = await generateCalendarImage(serverId, monthOffset);
  if (!calendarImage) {
    throw new Error('Failed to generate calendar image');
  }

  const base64Data = calendarImage.replace(/^data:image\/png;base64,/, '');
  const imageBuffer = Buffer.from(base64Data, 'base64');

  const missionEmbed = await buildMissionLogEmbed(serverId);
  const todaysCaptain = await getTodaysCaptain(serverId);
  const calendarEmbed = buildCalendarEmbed(todaysCaptain);
  const components = buildCalendarButtons(serverId);

  const botToken = ensureBotToken();
  const response = await sendDiscordMessageWithAttachment(
    channelId,
    [missionEmbed, calendarEmbed],
    components,
    imageBuffer,
    botToken
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Discord API error:', response.status, errorText);
    throw new Error(`Failed to post to Discord (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  await storeCalendarMessageMeta(serverId, {
    channelId,
    messageId: result.id,
    includeButtons: true,
    monthOffset,
  });

  return { success: true, messageId: result.id };
}

export async function shiftCalendarMonth(serverId: string, delta: number) {
  const serverDoc = await db.collection('servers').doc(serverId).get();
  const calendars = serverDoc.data()?.calendarMessages as CalendarMessageMeta[] | undefined;

  if (!calendars || calendars.length === 0) {
    return { success: false, message: 'No calendar messages found' };
  }

  const updatedCalendars = calendars.map(meta => {
    const currentOffset = meta.monthOffset ?? 0;
    const nextOffset = Math.max(-6, Math.min(6, currentOffset + delta));
    return { ...meta, monthOffset: nextOffset };
  });

  await db.collection('servers').doc(serverId).set({
    calendarMessages: updatedCalendars,
  }, { merge: true });

  const monthLabel = format(addMonths(new Date(), updatedCalendars[0].monthOffset ?? 0), 'MMMM yyyy');
  const refreshResult = await refreshCalendarMessage(serverId);
  return {
    ...refreshResult,
    monthLabel,
    monthOffset: updatedCalendars[0].monthOffset ?? 0,
  };
}
