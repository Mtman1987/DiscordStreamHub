import { NextRequest, NextResponse } from 'next/server';
import { postCalendarToDiscord } from '@/lib/calendar-discord-service-new';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId } = await request.json();
    
    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Server ID and Channel ID are required' }, { status: 400 });
    }

    const result = await postCalendarToDiscord(serverId, channelId, 0);
    return NextResponse.json(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = /Unknown Channel|code["']?:\s*10003|404/i.test(message) ? 400 : 500;
    if (status >= 500) {
      console.error('Calendar post error:', error);
    }
    const hint = status === 400 ? 'The configured Discord calendar channel is missing or the bot cannot access it. Pick a valid channel and try again.' : undefined;
    return NextResponse.json({ error: message, hint }, { status });
  }
}
