import { addMonths, format } from 'date-fns';
import { db } from '@/data/server-init';
import { generateCalendarImage } from '@/ai/flows/generate-calendar-image';
import {
  partitionCalendarMessages,
  upsertCalendarMessage,
  type CalendarMessageMeta,
} from './calendar-message-state';

export type { CalendarMessageMeta } from './calendar-message-state';

type CaptainHighlight = {
  username: string;
  avatarUrl?: string | null;
};

function ensureBotToken() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not configured');
  return token;
}

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
  if (!captainDoc) return null;

  const data = captainDoc.data();
  return {
    username: typeof data.username === 'string' ? data.username : 'Captain',
    avatarUrl: typeof data.userAvatar === 'string' ? data.userAvatar : null,
  };
}

export function buildCalendarEmbed(todaysCaptain?: CaptainHighlight | null) {
  const embed: Record<string, any> = {
    title: todaysCaptain
      ? `📅 Mission Calendar — ${todaysCaptain.username}`
      : '📅 Space Mountain Mission Calendar',
    description: todaysCaptain
      ? `👩‍✈️ Today’s Captain: **${todaysCaptain.username}**\nCurrent month fleet operations and captain assignments`
      : 'Current month fleet operations and captain assignments',
    image: { url: 'attachment://calendar.png' },
    color: 0x7C3AED,
    timestamp: new Date().toISOString(),
  };

  if (todaysCaptain?.avatarUrl) embed.thumbnail = { url: todaysCaptain.avatarUrl };
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
  const existing = (serverDoc.data()?.calendarMessages || []) as CalendarMessageMeta[];
  const updated = upsertCalendarMessage(existing, { ...meta, lastUpdated: new Date() });
  await serverRef.set({ calendarMessages: updated }, { merge: true });
}

function calendarPayload(serverId: string, embed: Record<string, any>, includeButtons: boolean) {
  return {
    embeds: [embed],
    attachments: [{ id: 0, filename: 'calendar.png' }],
    components: includeButtons ? buildCalendarButtons(serverId) : [],
  };
}

function calendarImageBuffer(calendarImage: string) {
  const base64Data = calendarImage.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

function calendarForm(payload: Record<string, unknown>, imageBuffer: Buffer) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', imageBuffer, { filename: 'calendar.png', contentType: 'image/png' });
  return form;
}

async function sendCalendarMessage(
  method: 'POST' | 'PATCH',
  channelId: string,
  messageId: string | undefined,
  payload: Record<string, unknown>,
  imageBuffer: Buffer,
  botToken: string,
) {
  const form = calendarForm(payload, imageBuffer);
  const url = messageId
    ? `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`
    : `https://discord.com/api/v10/channels/${channelId}/messages`;
  return fetch(url, {
    method,
    headers: { Authorization: `Bot ${botToken}`, ...form.getHeaders() },
    body: form.getBuffer(),
  });
}

async function deleteSupersededMessages(botToken: string, messages: readonly CalendarMessageMeta[]) {
  const failed: CalendarMessageMeta[] = [];
  const uniqueMessages = new Map(messages.map((message) => [`${message.channelId}:${message.messageId}`, message]));

  for (const message of uniqueMessages.values()) {
    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${message.channelId}/messages/${message.messageId}`,
        { method: 'DELETE', headers: { Authorization: `Bot ${botToken}` } },
      );
      if (!response.ok && response.status !== 404) {
        console.error(`[CalendarRefresh] Could not remove superseded message ${message.messageId}:`, response.status, await response.text());
        failed.push(message);
      }
    } catch (error) {
      console.error(`[CalendarRefresh] Could not remove superseded message ${message.messageId}:`, error);
      failed.push(message);
    }
  }
  return failed;
}

export async function refreshCalendarMessage(serverId: string) {
  const serverRef = db.collection('servers').doc(serverId);
  const serverDoc = await serverRef.get();
  const stored = (serverDoc.data()?.calendarMessages || []) as CalendarMessageMeta[];
  const { current: calendars, superseded } = partitionCalendarMessages(stored);

  if (calendars.length === 0) {
    console.warn(`[CalendarRefresh] No stored Discord metadata for server ${serverId}`);
    return { success: false, message: 'No calendar messages found' };
  }

  const botToken = ensureBotToken();
  const updatedCalendars: CalendarMessageMeta[] = [];

  for (const meta of calendars) {
    const monthOffset = meta.monthOffset ?? 0;
    const calendarImage = await generateCalendarImage(serverId, monthOffset);
    if (!calendarImage) {
      updatedCalendars.push(meta);
      continue;
    }

    const todaysCaptain = await getTodaysCaptain(serverId);
    const payload = calendarPayload(serverId, buildCalendarEmbed(todaysCaptain), meta.includeButtons ?? true);
    const response = await sendCalendarMessage(
      'PATCH',
      meta.channelId,
      meta.messageId,
      payload,
      calendarImageBuffer(calendarImage),
      botToken,
    );

    if (response.ok) {
      updatedCalendars.push({ ...meta, monthOffset, lastUpdated: new Date() });
    } else if (response.status === 404) {
      console.log(`[CalendarRefresh] Message ${meta.messageId} not found, removing it from the calendar list`);
    } else {
      console.error(`[CalendarRefresh] Discord error for ${meta.messageId}:`, response.status, await response.text());
      updatedCalendars.push(meta);
    }
  }

  const failedDeletions = await deleteSupersededMessages(botToken, superseded);
  // Keep failed cleanup IDs before refreshed canonical IDs so the newest message wins next time.
  await serverRef.set({ calendarMessages: [...failedDeletions, ...updatedCalendars] }, { merge: true });
  return { success: true, updated: updatedCalendars.length };
}

export async function postCalendarToDiscord(
  serverId: string,
  channelId: string,
  monthOffset = 0,
  includeButtons = true,
) {
  const serverRef = db.collection('servers').doc(serverId);
  const serverDoc = await serverRef.get();
  const stored = (serverDoc.data()?.calendarMessages || []) as CalendarMessageMeta[];
  const { current: calendars, superseded } = partitionCalendarMessages(stored);
  const existing = calendars.find((meta) => meta.channelId === channelId);

  const calendarImage = await generateCalendarImage(serverId, monthOffset);
  if (!calendarImage) throw new Error('Failed to generate calendar image');

  const todaysCaptain = await getTodaysCaptain(serverId);
  const payload = calendarPayload(serverId, buildCalendarEmbed(todaysCaptain), includeButtons);
  const imageBuffer = calendarImageBuffer(calendarImage);
  const botToken = ensureBotToken();

  let response: Response;
  if (existing) {
    response = await sendCalendarMessage('PATCH', channelId, existing.messageId, payload, imageBuffer, botToken);
    if (response.status === 404) {
      response = await sendCalendarMessage('POST', channelId, undefined, payload, imageBuffer, botToken);
    }
  } else {
    response = await sendCalendarMessage('POST', channelId, undefined, payload, imageBuffer, botToken);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Discord API error:', response.status, errorText);
    throw new Error(`Failed to publish calendar to Discord (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const messageMeta: CalendarMessageMeta = {
    channelId,
    messageId: result.id,
    includeButtons,
    monthOffset,
    lastUpdated: new Date(),
  };
  const obsoleteForChannel = superseded.filter((message) => message.channelId === channelId);
  const failedDeletions = await deleteSupersededMessages(botToken, obsoleteForChannel);
  const otherChannelMeta = stored.filter((message) => message.channelId !== channelId);
  const refreshedOtherChannels = calendars.filter((message) => message.channelId !== channelId);
  const failedOtherChannelDuplicates = superseded.filter((message) => message.channelId !== channelId);
  const cleaned = [
    ...otherChannelMeta.filter((message) => refreshedOtherChannels.some((current) => current.messageId === message.messageId)),
    ...failedOtherChannelDuplicates,
    ...failedDeletions,
    messageMeta,
  ];
  await serverRef.set({ calendarMessages: cleaned }, { merge: true });

  return { success: true, messageId: result.id, updated: Boolean(existing) };
}

export async function shiftCalendarMonth(serverId: string, delta: number) {
  const serverRef = db.collection('servers').doc(serverId);
  const serverDoc = await serverRef.get();
  const stored = (serverDoc.data()?.calendarMessages || []) as CalendarMessageMeta[];
  const { current: calendars, superseded } = partitionCalendarMessages(stored);

  if (calendars.length === 0) return { success: false, message: 'No calendar messages found' };

  const updatedCalendars = calendars.map((meta) => ({
    ...meta,
    monthOffset: Math.max(-6, Math.min(6, (meta.monthOffset ?? 0) + delta)),
  }));
  await serverRef.set({ calendarMessages: [...superseded, ...updatedCalendars] }, { merge: true });

  const monthLabel = format(addMonths(new Date(), updatedCalendars[0].monthOffset ?? 0), 'MMMM yyyy');
  const refreshResult = await refreshCalendarMessage(serverId);
  return { ...refreshResult, monthLabel, monthOffset: updatedCalendars[0].monthOffset ?? 0 };
}
