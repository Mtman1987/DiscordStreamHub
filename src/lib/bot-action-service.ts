import { db } from '@/lib/db';
import { submitCaptainLog, submitMission } from '@/lib/calendar-admin-actions';
import { postCalendarToDiscord, refreshCalendarMessage } from '@/lib/calendar-discord-service-new';
import { publicApplicationEmbed } from '@/lib/application-flow';
import {
  decideApplication,
  isApplicationOwner,
  notifyApplicationDecision,
  type ApplicationDecision,
} from '@/lib/application-admin-actions';
import { registerManualDiscordShoutout } from '@/lib/manual-discord-shoutout-service';

export const DSH_BOT_ACTIONS = [
  'dsh.shoutouts.active.read',
  'dsh.shoutouts.live.read',
  'dsh.shoutouts.post',
  'dsh.calendar.read',
  'dsh.calendar.captain.read',
  'dsh.calendar.captain.create',
  'dsh.calendar.event.create',
  'dsh.calendar.deploy',
  'dsh.calendar.refresh',
  'dsh.applications.read',
  'dsh.applications.deploy',
  'dsh.applications.decide',
] as const;

export type DshBotActionId = typeof DSH_BOT_ACTIONS[number];

type BotActionInput = {
  action: DshBotActionId;
  serverId: string;
  actorUserId?: string;
  channel?: string;
  channelId?: string;
  selectedDate?: string;
  missionName?: string;
  missionDescription?: string;
  missionDate?: string;
  missionTime?: string;
  missionTimeZone?: string;
  status?: string;
  type?: string;
  target?: string;
  application?: string;
  decision?: string;
  requesterName?: string;
  idempotencyKey?: string;
};

type ChannelRow = { id: string; name: string; type?: number };

function clean(value: unknown, max = 500): string {
  return String(value || '').trim().slice(0, max);
}

function timestampIso(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? null : date.toISOString();
  }
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function listConfiguredChannels(serverId: string): Promise<ChannelRow[]> {
  const snapshot = await db.doc(`servers/${serverId}/config/channels`).get();
  const list = snapshot.data()?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((channel: any) => ({
      id: clean(channel?.id, 64),
      name: clean(channel?.name, 100),
      type: Number(channel?.type),
    }))
    .filter((channel: ChannelRow) => channel.id && channel.name);
}

async function fetchDiscordChannels(serverId: string): Promise<ChannelRow[]> {
  const botToken = clean(process.env.DISCORD_BOT_TOKEN, 5000);
  if (!botToken) return [];
  const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(serverId)}/channels`, {
    headers: { Authorization: `Bot ${botToken}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows)
    ? rows.map((channel: any) => ({ id: clean(channel?.id, 64), name: clean(channel?.name, 100), type: Number(channel?.type) }))
      .filter((channel: ChannelRow) => channel.id && channel.name)
    : [];
}

export async function resolveDiscordChannel(serverId: string, selector: string): Promise<ChannelRow> {
  const raw = clean(selector, 100).replace(/^#/, '');
  if (!raw) throw new Error('A Discord channel name or ID is required.');
  const channels = [
    ...await listConfiguredChannels(serverId),
    ...await fetchDiscordChannels(serverId),
  ];
  const unique = Array.from(new Map(channels.map((channel) => [channel.id, channel])).values());
  const byId = unique.find((channel) => channel.id === raw);
  if (byId) return byId;
  const byName = unique.filter((channel) => channel.name.toLowerCase() === raw.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`More than one Discord channel is named #${raw}. Use its channel ID.`);
  throw new Error(`Discord channel #${raw} was not found or is not visible to the bot.`);
}

export async function listActiveShoutouts(serverId: string, liveOnly = false) {
  const users = await db.collection('servers').doc(serverId).collection('users').get();
  const rows: Array<Record<string, unknown>> = [];
  for (const userDoc of users.docs) {
    const state = await userDoc.ref.collection('shoutoutState').doc('current').get();
    if (!state.exists) continue;
    const user = userDoc.data() || {};
    const current = state.data() || {};
    if (liveOnly && current.isLive !== true) continue;
    rows.push({
      discordUserId: userDoc.id,
      username: clean(user.username || user.displayName || userDoc.id, 100),
      twitchLogin: clean(user.twitchLogin, 100),
      isLive: current.isLive === true,
      channelId: clean(current.channelId, 64),
      messageId: clean(current.messageId, 64),
      updatedAt: timestampIso(current.updatedAt || current.lastUpdated || current.createdAt),
    });
  }
  return rows.sort((left, right) => String(left.username).localeCompare(String(right.username)));
}

export async function listCalendar(serverId: string) {
  const snapshot = await db.collection('servers').doc(serverId).collection('calendarEvents').get();
  return snapshot.docs
    .map((doc: any) => {
      const event = doc.data() || {};
      return {
        id: doc.id,
        eventName: clean(event.eventName, 160),
        description: clean(event.description, 1000),
        type: clean(event.type, 64),
        userId: clean(event.userId, 64),
        username: clean(event.username, 100),
        dayKey: clean(event.dayKey, 32),
        eventDateTime: timestampIso(event.eventDateTime),
      };
    })
    .sort((left: any, right: any) => String(left.eventDateTime || '').localeCompare(String(right.eventDateTime || '')));
}

async function listApplications(serverId: string, status?: string, type?: string) {
  const snapshot = await db.collection('servers').doc(serverId).collection('applications').get();
  return snapshot.docs
    .map((doc: any) => {
      const application = doc.data() || {};
      return {
        id: doc.id,
        type: clean(application.type, 40),
        status: clean(application.status, 40) || 'pending',
        userId: clean(application.userId, 64),
        username: clean(application.username || application.displayName, 100),
        submittedAt: timestampIso(application.submittedAt || application.createdAt),
        agreementStatus: clean(application.agreementStatus, 64),
      };
    })
    .filter((application: any) => !status || application.status === status)
    .filter((application: any) => !type || application.type === type)
    .sort((left: any, right: any) => String(right.submittedAt || '').localeCompare(String(left.submittedAt || '')));
}

async function resolveApplication(serverId: string, selector: string, type?: string) {
  const needle = clean(selector, 160).toLowerCase();
  if (!needle) throw new Error('An application ID or applicant name is required.');
  const rows = await listApplications(serverId, '', clean(type, 40));
  const exact = rows.filter((application: any) =>
    String(application.id).toLowerCase() === needle
    || String(application.userId).toLowerCase() === needle
    || String(application.username).toLowerCase() === needle
  );
  const candidates = exact.length ? exact : rows.filter((application: any) =>
    String(application.username).toLowerCase().includes(needle)
  );
  if (!candidates.length) throw new Error(`Application ${selector} was not found.`);
  if (candidates.length > 1) throw new Error(`More than one application matches ${selector}. Use the application ID.`);
  return candidates[0];
}

export async function postApplicationEmbed(serverId: string, channelId: string) {
  const botToken = clean(process.env.DISCORD_BOT_TOKEN, 5000);
  if (!botToken) throw new Error('Discord bot token is not configured.');
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(publicApplicationEmbed(serverId)),
  });
  if (!response.ok) {
    const error = clean(await response.text().catch(() => ''), 500);
    throw new Error(`Discord rejected the application embed (${response.status})${error ? `: ${error}` : ''}`);
  }
  const message = await response.json().catch(() => ({}));
  return { success: true as const, messageId: clean(message?.id, 64), channelId };
}

async function withIdempotencyReceipt<T>(input: BotActionInput, operation: () => Promise<T>): Promise<T & { duplicate?: boolean }> {
  const key = clean(input.idempotencyKey, 160);
  if (!key) return operation() as Promise<T & { duplicate?: boolean }>;
  const receiptRef = db.doc(`servers/${input.serverId}/botActionReceipts/${key}`);
  const existing = await receiptRef.get();
  if (existing.exists) return { ...(existing.data()?.result || {}), duplicate: true } as T & { duplicate?: boolean };
  const result = await operation();
  await receiptRef.set({
    action: input.action,
    actorUserId: clean(input.actorUserId, 64),
    createdAt: new Date().toISOString(),
    result,
  });
  return { ...(result as any), duplicate: false };
}

export async function executeDshBotAction(input: BotActionInput): Promise<Record<string, unknown>> {
  const serverId = clean(input.serverId, 64);
  if (!serverId) throw new Error('Discord server ID is required.');
  const actorUserId = clean(input.actorUserId, 64);

  if (input.action === 'dsh.shoutouts.active.read' || input.action === 'dsh.shoutouts.live.read') {
    const shoutouts = await listActiveShoutouts(serverId, input.action.endsWith('.live.read'));
    return { success: true, action: input.action, count: shoutouts.length, shoutouts };
  }

  if (input.action === 'dsh.shoutouts.post') {
    const channel = await resolveDiscordChannel(serverId, clean(input.channelId || input.channel, 100));
    const targetName = clean(input.target, 100).replace(/^@/, '');
    if (!targetName) throw new Error('A Twitch username is required for the shoutout.');
    return withIdempotencyReceipt(input, async () => ({
      success: true as const,
      channel,
      targetName,
      ...(await registerManualDiscordShoutout({
        serverId,
        channelId: channel.id,
        requesterName: clean(input.requesterName, 100) || 'StreamWeaver bot action',
        requesterDiscordId: actorUserId || null,
        targetName,
        targetDiscordUserId: null,
        sourceMessageId: clean(input.idempotencyKey, 160) || null,
      })),
    }));
  }

  if (input.action === 'dsh.calendar.read' || input.action === 'dsh.calendar.captain.read') {
    const allEvents = await listCalendar(serverId);
    const events = input.action.endsWith('.captain.read')
      ? allEvents.filter((event: any) => event.type === 'captains-log')
      : allEvents;
    return { success: true, action: input.action, count: events.length, events };
  }

  if (input.action === 'dsh.applications.read') {
    const applications = await listApplications(serverId, clean(input.status, 40), clean(input.type, 40));
    return { success: true, action: input.action, count: applications.length, applications };
  }

  if (input.action === 'dsh.calendar.captain.create') {
    if (!actorUserId) throw new Error('A linked Discord user is required for Captain\'s Log.');
    return withIdempotencyReceipt(input, async () => {
      const result = await submitCaptainLog({ serverId, userId: actorUserId, selectedDate: clean(input.selectedDate, 32) });
      if (!result.success) throw new Error(result.error);
      return result;
    });
  }

  if (input.action === 'dsh.calendar.event.create') {
    if (!actorUserId) throw new Error('A linked Discord user is required to create a calendar event.');
    return withIdempotencyReceipt(input, async () => {
      const result = await submitMission({
        serverId,
        userId: actorUserId,
        missionName: clean(input.missionName, 160),
        missionDescription: clean(input.missionDescription, 1000),
        missionDate: clean(input.missionDate, 32),
        missionTime: clean(input.missionTime, 16),
        missionTimeZone: clean(input.missionTimeZone, 16),
      });
      if (!result.success) throw new Error(result.error);
      return result;
    });
  }

  if (input.action === 'dsh.calendar.deploy') {
    const channel = await resolveDiscordChannel(serverId, clean(input.channelId || input.channel, 100));
    return withIdempotencyReceipt(input, async () => ({
      ...(await postCalendarToDiscord(serverId, channel.id, 0)),
      success: true as const,
      channel,
    }));
  }

  if (input.action === 'dsh.calendar.refresh') {
    const result = await refreshCalendarMessage(serverId);
    if (!result.success) throw new Error(result.message || 'Calendar refresh failed.');
    return { success: true, action: input.action };
  }

  if (input.action === 'dsh.applications.deploy') {
    const channel = await resolveDiscordChannel(serverId, clean(input.channelId || input.channel, 100));
    return withIdempotencyReceipt(input, async () => ({
      ...(await postApplicationEmbed(serverId, channel.id)),
      channel,
    }));
  }

  if (input.action === 'dsh.applications.decide') {
    if (!actorUserId || !isApplicationOwner(serverId, actorUserId)) {
      throw new Error('Only the server owner can approve or reject applications.');
    }
    const decision = clean(input.decision, 20) as ApplicationDecision;
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('The application decision must be approved or rejected.');
    }
    const application = await resolveApplication(serverId, clean(input.application, 160), clean(input.type, 40));
    return withIdempotencyReceipt(input, async () => {
      const decided = await decideApplication({
        serverId,
        applicationId: application.id,
        reviewerId: actorUserId,
        status: decision,
      });
      const notification = await notifyApplicationDecision({
        serverId,
        applicationId: application.id,
        ownerId: actorUserId,
        status: decision,
        expectedUserId: application.userId,
      });
      return { success: true as const, application: decided, notification };
    });
  }

  throw new Error(`Unsupported DiscordStreamHub bot action: ${input.action}`);
}
