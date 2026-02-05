'use server';

import { Timestamp } from 'firebase-admin/firestore';
import { format } from 'date-fns';
import { db } from '@/firebase/server-init';
import { refreshCalendarMessage } from '@/lib/calendar-discord-service';

type CaptainLogPayload = {
  serverId: string;
  userId: string;
  selectedDate: string;
};

type MissionPayload = {
  serverId: string;
  userId: string;
  missionName: string;
  missionDescription: string;
  missionDate: string;
  missionTime?: string;
};

function invalidResponse(message: string, statusCode = 400) {
  return { success: false, error: message, statusCode };
}

function toDateAtNoonUTC(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  if ([year, month, day].some((value) => Number.isNaN(value))) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function buildLocalDateTime(dateStr: string, timeStr?: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  if ([year, month, day].some((value) => Number.isNaN(value))) {
    return null;
  }

  let hours = 12;
  let minutes = 0;

  if (timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    hours = Number.isNaN(h) ? 12 : h;
    minutes = Number.isNaN(m) ? 0 : m;
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

export async function submitCaptainLog(payload: CaptainLogPayload) {
  const { serverId, userId, selectedDate } = payload;
  if (!serverId || !userId || !selectedDate) {
    return invalidResponse('Missing required fields');
  }

  const logDate = toDateAtNoonUTC(selectedDate);
  if (!logDate) {
    return invalidResponse('Invalid date format');
  }

  const userSnap = await db.doc(`servers/${serverId}/users/${userId}`).get();
  if (!userSnap.exists) {
    return invalidResponse('User not found', 404);
  }

  const userData = userSnap.data() || {};

  const dayKey = format(logDate, 'yyyy-MM-dd');

  const eventsRef = db.collection('servers').doc(serverId).collection('calendarEvents');
  const sameDaySnapshot = await eventsRef.where('dayKey', '==', dayKey).limit(25).get();

  const dayAlreadyClaimed = sameDaySnapshot.docs.some((doc) => doc.data()?.type === 'captains-log');

  if (dayAlreadyClaimed) {
    return invalidResponse('That day is already claimed.', 409);
  }

  await eventsRef.add({
    eventName: `Captain's Log - ${logDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    eventDateTime: Timestamp.fromDate(logDate),
    description: `${userData.username || 'Unknown pilot'} signed up for captain's log duty`,
    type: 'captains-log',
    userId,
    userAvatar: userData.avatarUrl || null,
    username: userData.username || 'Unknown pilot',
    dayKey,
  });

  await refreshCalendarMessage(serverId);
  
  // Award points
  try {
    const { awardPoints } = await import('./points-service');
    await awardPoints({
      serverId,
      userId,
      eventType: 'admin_captains_log',
      quantity: 1,
      source: 'manual',
      metadata: { username: userData.username, date: selectedDate }
    });
  } catch (error) {
    console.error('Failed to award captain log points:', error);
  }

  return {
    success: true,
    message: `Captain's log scheduled for ${logDate.toLocaleDateString()}.`,
  };
}

export async function submitMission(payload: MissionPayload) {
  const { serverId, userId, missionName, missionDescription, missionDate, missionTime } = payload;
  if (!serverId || !userId || !missionName || !missionDescription || !missionDate) {
    return invalidResponse('Missing required fields');
  }

  const userSnap = await db.doc(`servers/${serverId}/users/${userId}`).get();
  if (!userSnap.exists) {
    return invalidResponse('User not found', 404);
  }

  const userData = userSnap.data() || {};

  const missionDateTime = buildLocalDateTime(missionDate, missionTime);
  if (!missionDateTime || Number.isNaN(missionDateTime.getTime())) {
    return invalidResponse('Invalid mission date');
  }

  const dayKey = format(missionDateTime, 'yyyy-MM-dd');

  await db.collection('servers').doc(serverId).collection('calendarEvents').add({
    eventName: missionName,
    eventDateTime: Timestamp.fromDate(missionDateTime),
    description: missionDescription,
    type: 'event',
    userId,
    userAvatar: userData.avatarUrl || null,
    username: userData.username || 'Unknown pilot',
    dayKey,
  });

  await refreshCalendarMessage(serverId);
  
  // Award points
  try {
    const { awardPoints } = await import('./points-service');
    await awardPoints({
      serverId,
      userId,
      eventType: 'admin_calendar_event',
      quantity: 1,
      source: 'manual',
      metadata: { username: userData.username, missionName }
    });
  } catch (error) {
    console.error('Failed to award mission points:', error);
  }

  return {
    success: true,
    message: `Mission "${missionName}" scheduled for ${missionDateTime.toLocaleDateString()}.`,
  };
}
