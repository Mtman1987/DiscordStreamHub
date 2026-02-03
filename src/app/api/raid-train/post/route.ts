import { NextRequest, NextResponse } from 'next/server';
import { raidTrainService } from '@/lib/raid-train-service';
import { addDays } from 'date-fns';

export async function POST(request: NextRequest) {
  try {
    const { serverId, channelId, date } = await request.json();
    
    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Server ID and Channel ID are required' }, { status: 400 });
    }

    const targetDate = date ? new Date(date) : addDays(new Date(), 1); // Default to tomorrow
    const slots = await raidTrainService.getScheduleForDate(serverId, targetDate);
    const embed = raidTrainService.generateScheduleEmbed(slots, targetDate);
    const components = raidTrainService.generateScheduleButtons(targetDate);

    // Post to Discord
    const discordResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/discord/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId,
        embeds: [embed],
        components,
      }),
    });

    if (!discordResponse.ok) {
      throw new Error('Failed to post to Discord');
    }

    const result = await discordResponse.json();
    return NextResponse.json({ success: true, messageId: result.messageId });

  } catch (error) {
    console.error('Raid train post error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}