import { NextRequest, NextResponse } from 'next/server';
import { generateScheduleEmbed, savePartnerScheduleThread } from '@/lib/partner-schedule-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[PartnerSchedule] Request:', body);
    const { action, userId, serverId, threadId, channelId, messageId, imageUrl } = body;

    if (action === 'prepare') {
      // Just store the schedule data, don't generate image
      const { fetchTwitchSchedule } = await import('@/lib/partner-schedule-service');
      const { db } = await import('@/data/server-init');
      
      const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
      const twitchId = userDoc.data()?.twitchId;
      
      if (!twitchId) {
        return NextResponse.json({ error: 'No Twitch account linked' }, { status: 400 });
      }

      const segments = await fetchTwitchSchedule(twitchId, '');
      
      // Store events in the app database.
      const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents');
      const batch = db.batch();
      
      // Clear old events
      const oldEvents = await eventsRef.get();
      oldEvents.docs.forEach((doc: { ref: any }) => batch.delete(doc.ref));
      
      // Add new events
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
      return NextResponse.json({ success: true });
    }

    if (action === 'generate') {
      // Generate calendar and return image URL
      const embed = await generateScheduleEmbed(userId, serverId);
      if (!embed || !embed.embeds[0].image) {
        return NextResponse.json({ error: 'Failed to generate calendar' }, { status: 400 });
      }
      return NextResponse.json({ imageUrl: embed.embeds[0].image.url });
    }

    if (action === 'post') {
      // Post the calendar with provided image URL
      const { postDiscordMessage } = await import('@/lib/discord-sync-service');
      const embed = {
        embeds: [{
          title: `📅 Stream Schedule`,
          image: { url: imageUrl },
          color: 0x9146FF
        }]
      };
      await postDiscordMessage(serverId, threadId, embed);
      return NextResponse.json({ success: true });
    }

    if (action === 'setup') {
      const { postDiscordMessage } = await import('@/lib/discord-sync-service');
      
      const setupEmbed = {
        content: '**📅 Twitch Schedule Calendar Setup**\n\nEnter your Twitch username to display your stream schedule here. This will show your upcoming streams and allow you to add custom events.',
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 1,
            label: '📝 Enter Twitch Username',
            custom_id: `partner_schedule_username_${userId}_${serverId}_${threadId}`
          }]
        }]
      };

      console.log('[PartnerSchedule] Posting to channel:', threadId);
      await postDiscordMessage(serverId, threadId, setupEmbed);
      console.log('[PartnerSchedule] Success!');
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Partner schedule error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
