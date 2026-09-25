import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { timestampToDate } from '@/lib/date-utils';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await db.collection('servers').doc(getHardcodedGuildId()).collection('calendarEvents').get();
    const now = Date.now();
    const events = snapshot.docs
      .flatMap((doc: { id: string; data: () => any }) => {
        const data = doc.data() || {};
        const date = timestampToDate(data.eventDateTime);
        const title = String(data.eventName || '').trim();
        if (data.type === 'captains-log' || !title || !date || date.getTime() < now) return [];
        return [{
          id: doc.id,
          title,
          type: String(data.type || 'event'),
          startsAt: date.toISOString(),
        }];
      })
      .sort((left: { startsAt: string }, right: { startsAt: string }) => left.startsAt.localeCompare(right.startsAt))
      .slice(0, 3);

    return NextResponse.json({ events }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('[CommunityEvents] Failed to read calendar:', error);
    return NextResponse.json({ error: 'Calendar unavailable', events: [] }, { status: 503 });
  }
}
