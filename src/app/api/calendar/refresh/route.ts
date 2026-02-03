import { NextRequest, NextResponse } from 'next/server';
import { refreshCalendarMessage } from '@/lib/calendar-discord-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    const result = await refreshCalendarMessage(serverId);
    if (!result.success) {
      return NextResponse.json({ error: result.message || 'Failed to refresh calendar' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CalendarRefreshAPI] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
