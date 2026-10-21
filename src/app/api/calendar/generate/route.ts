import { NextRequest, NextResponse } from 'next/server';
import { postCalendarToDiscord } from '@/lib/calendar-discord-service-new';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId, includeButtons = false } = await request.json();

    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Server ID and Channel ID are required' }, { status: 400 });
    }

    const result = await postCalendarToDiscord(serverId, channelId, 0, includeButtons);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Calendar generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
