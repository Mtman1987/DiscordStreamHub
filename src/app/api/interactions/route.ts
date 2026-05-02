import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { shiftCalendarMonth } from '@/lib/calendar-discord-service';
import { db } from '@/firebase/server-init';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const rawBody = await request.text();

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 401 });
  }

  const isValid = verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // Ping response
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  // Button interaction
  if (interaction.type === 3) {
    const customId = interaction.data.custom_id;
    
    // Partner schedule username entry
    if (customId.startsWith('partner_schedule_username_')) {
      const [, , , userId, serverId, threadId] = customId.split('_');
      
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Enter Twitch Username',
          custom_id: `partner_username_submit_${userId}_${serverId}_${threadId}`,
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'twitch_username',
                label: 'Your Twitch Username',
                style: 1,
                placeholder: 'e.g. mtman1987',
                required: true,
                max_length: 25
              }]
            }
          ]
        }
      });
    }
    
    // Partner schedule buttons
    if (customId.startsWith('partner_schedule_seturl_')) {
      const [, , , userId, serverId] = customId.split('_');
      const clickerId = interaction.member?.user?.id || interaction.user?.id;
      
      if (clickerId !== userId) {
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Only the schedule owner can set the calendar URL', flags: 64 }
        });
      }
      
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Set Google Calendar URL',
          custom_id: `partner_calurl_submit_${userId}_${serverId}`,
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'calendar_url',
                label: 'Google Calendar Public URL',
                style: 1,
                placeholder: 'https://calendar.google.com/calendar/u/0?cid=...',
                required: true,
                max_length: 500
              }]
            }
          ]
        }
      });
    }

    if (customId.startsWith('partner_paste_ical_')) {
      const parts = customId.replace('partner_paste_ical_', '').split('_');
      const ownerId = parts[0];
      const serverId = parts[1];
      return NextResponse.json({
        type: 9,
        data: {
          custom_id: `partner_schedule_seturl_modal_${ownerId}_${serverId}`,
          title: 'Sync Google Calendar',
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'google_ical_url',
                label: 'Google Calendar iCal URL',
                style: 2,
                required: true,
                placeholder: 'https://calendar.google.com/calendar/ical/...'
              }]
            }
          ]
        }
      });
    }
    
    if (customId.startsWith('partner_schedule_refresh_')) {
      const [, , , userId, serverId] = customId.split('_');
      const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
      const { editDiscordMessage } = await import('@/lib/discord-sync-service');
      
      const embed = await generateScheduleEmbed(userId, serverId);
      if (embed) {
        await editDiscordMessage(serverId, interaction.channel_id, interaction.message.id, embed);
      }
      
      return NextResponse.json({
        type: 4,
        data: { content: '🔄 Schedule refreshed!', flags: 64 }
      });
    }
    
    if (customId.startsWith('partner_schedule_add_')) {
      const [, , , userId, serverId] = customId.split('_');
      const clickerId = interaction.member?.user?.id || interaction.user?.id;
      
      if (clickerId !== userId) {
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Only the schedule owner can add events', flags: 64 }
        });
      }
      
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Add Custom Event',
          custom_id: `partner_event_submit_${userId}_${serverId}`,
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'event_name',
                label: 'Event Title',
                style: 1,
                placeholder: 'e.g. Special Stream, Charity Event',
                required: true,
                max_length: 100
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'event_date',
                label: 'Date',
                style: 1,
                placeholder: `YYYY-MM-DD (e.g. ${new Date().toISOString().split('T')[0]})`,
                required: true,
                min_length: 10,
                max_length: 10
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'event_time',
                label: 'Time (24-hour)',
                style: 1,
                placeholder: 'HH:MM (e.g. 14:30)',
                required: true,
                min_length: 5,
                max_length: 5
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'event_description',
                label: 'Description',
                style: 2,
                placeholder: 'What is this event about?',
                required: true,
                max_length: 200
              }]
            }
          ]
        }
      });
    }
    
    if (customId.startsWith('calendar_prev_month_')) {
      const serverId = customId.replace('calendar_prev_month_', '');
      await shiftCalendarMonth(serverId, -1);
      return NextResponse.json({
        type: 4,
        data: { content: '⬅️ Moved to previous month', flags: 64 }
      });
    }
    
    if (customId.startsWith('calendar_next_month_')) {
      const serverId = customId.replace('calendar_next_month_', '');
      await shiftCalendarMonth(serverId, 1);
      return NextResponse.json({
        type: 4,
        data: { content: '➡️ Moved to next month', flags: 64 }
      });
    }

    if (customId.startsWith('calendar_captain_log_')) {
      const serverId = customId.replace('calendar_captain_log_', '');
      return NextResponse.json({
        type: 9,
        data: {
          title: "Claim Captain's Log Day",
          custom_id: `captain_log_submit_${serverId}`,
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'log_date',
                  label: 'Which day do you want to claim?',
                  style: 1,
                  placeholder: `Format: YYYY-MM-DD (e.g. ${new Date().toISOString().split('T')[0]})`,
                  required: true,
                  min_length: 10,
                  max_length: 10
                }
              ]
            }
          ]
        }
      });
    }

    if (customId.startsWith('calendar_add_mission_')) {
      const serverId = customId.replace('calendar_add_mission_', '');
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Schedule a Mission/Event',
          custom_id: `add_mission_submit_${serverId}`,
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'mission_name',
                  label: 'Event/Mission Title',
                  style: 1,
                  placeholder: 'e.g. Raid Night, Community Meeting',
                  required: true,
                  max_length: 100
                }
              ]
            },
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'mission_date',
                  label: 'Date',
                  style: 1,
                  placeholder: `Format: YYYY-MM-DD (e.g. ${new Date().toISOString().split('T')[0]})`,
                  required: true,
                  min_length: 10,
                  max_length: 10
                }
              ]
            },
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'mission_time',
                  label: 'Time (24-hour format)',
                  style: 1,
                  placeholder: 'Format: HH:MM (e.g. 14:30 for 2:30 PM)',
                  required: true,
                  min_length: 5,
                  max_length: 5
                }
              ]
            },
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'mission_description',
                  label: 'Event Description',
                  style: 2,
                  placeholder: 'What is this event about?',
                  required: true,
                  max_length: 500
                }
              ]
            }
          ]
        }
      });
    }

    return NextResponse.json({
      type: 4,
      data: { content: 'Button not implemented yet', flags: 64 }
    });
  }

  // Modal submission
  if (interaction.type === 5) {
    const customId = interaction.data.custom_id;
    
    // Partner username submission
    if (customId.startsWith('partner_username_submit_') || customId.startsWith('partner_schedule_modal_')) {
      let userId: string;
      let serverId: string;
      let threadId: string;

      if (customId.startsWith('partner_schedule_modal_')) {
        const parts = customId.replace('partner_schedule_modal_', '').split('_');
        userId = parts[0];
        serverId = parts[1];
        threadId = parts[2];
      } else {
        const parts = customId.replace('partner_username_submit_', '').split('_');
        userId = parts[0];
        serverId = parts[1];
        threadId = parts[2];
      }

      const twitchUsername = interaction.data.components[0].components[0].value;
      
      // Defer the response immediately
      await fetch(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 5, data: { flags: 64 } })
      });
      
      console.log('[PartnerUsername] Storing username:', twitchUsername, 'for user:', userId);
      
      await db.collection('servers').doc(serverId).collection('users').doc(userId).update({
        twitchLogin: twitchUsername.toLowerCase(),
        updatedAt: new Date()
      });
      
      console.log('[PartnerUsername] Generating schedule embed...');
      const { generateScheduleEmbed, savePartnerScheduleThread } = await import('@/lib/partner-schedule-service');
      const { postDiscordMessage } = await import('@/lib/discord-sync-service');
      
      const embed = await generateScheduleEmbed(userId, serverId, { forceRefresh: true });
      console.log('[PartnerUsername] Embed generated:', !!embed);
      
      if (embed) {
        console.log('[PartnerUsername] Posting to thread:', threadId);
        await postDiscordMessage(serverId, threadId, embed);
        await savePartnerScheduleThread(userId, serverId, threadId, threadId);
        console.log('[PartnerUsername] Calendar posted successfully!');
      } else {
        console.log('[PartnerUsername] Embed was null, not posting');
      }
      
      // Edit the deferred response
      await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${interaction.token}/messages/@original`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: embed ? `✅ Schedule calendar posted for @${twitchUsername}!` : '❌ Failed to generate calendar. Please try again.'
        })
      });
      
      return new Response(null, { status: 200 });
    }
    
    // Partner calendar URL submission
    if (customId.startsWith('partner_calurl_submit_') || customId.startsWith('partner_schedule_seturl_modal_')) {
      let userId: string;
      let serverId: string;

      if (customId.startsWith('partner_schedule_seturl_modal_')) {
        const parts = customId.replace('partner_schedule_seturl_modal_', '').split('_');
        userId = parts[0];
        serverId = parts[1];
      } else {
        const parts = customId.replace('partner_calurl_submit_', '').split('_');
        userId = parts[0];
        serverId = parts[1];
      }

      const rawField = interaction.data.components[0].components[0];
      const calendarUrl = rawField.value;
      
      await db.collection('servers').doc(serverId).collection('users').doc(userId).update({
        googleCalendarUrl: calendarUrl,
        googleIcalUrl: calendarUrl,
        updatedAt: new Date()
      });
      
      const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
      const { editDiscordMessage } = await import('@/lib/discord-sync-service');
      
      const embed = await generateScheduleEmbed(userId, serverId);
      if (embed) {
        await editDiscordMessage(serverId, interaction.channel_id, interaction.message.id, embed);
      }
      
      return NextResponse.json({
        type: 4,
        data: { 
          content: '✅ Calendar URL saved and schedule updated!',
          flags: 64 
        }
      });
    }
    
    // Partner event submission
    if (customId.startsWith('partner_event_submit_') || customId.startsWith('partner_schedule_add_modal_')) {
      let userId: string;
      let serverId: string;

      if (customId.startsWith('partner_schedule_add_modal_')) {
        const parts = customId.replace('partner_schedule_add_modal_', '').split('_');
        userId = parts[0];
        serverId = parts[1];
      } else {
        const parts = customId.replace('partner_event_submit_', '').split('_');
        userId = parts[0];
        serverId = parts[1];
      }

      const components = interaction.data.components;
      const eventName = components[0].components[0].value;
      const eventDate = components[1].components[0].value;
      const eventTime = components[2].components[0].value;
      const eventDescription = components[3]?.components?.[0]?.value || 'Custom Event';
      const eventDateTime = new Date(`${eventDate}T${eventTime}`);

      const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
      const { editDiscordMessage } = await import('@/lib/discord-sync-service');

      await db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents').add({
        eventName,
        description: eventDescription,
        eventDateTime,
        type: 'custom',
        isRecurring: false
      });
      
      // Refresh the schedule embed
      const embed = await generateScheduleEmbed(userId, serverId);
      if (embed) {
        await editDiscordMessage(serverId, interaction.channel_id, interaction.message.id, embed);
      }
      
      return NextResponse.json({
        type: 4,
        data: { 
          content: `✅ Event "${eventName}" added to your schedule!`,
          flags: 64 
        }
      });
    }
    
    if (customId.startsWith('captain_log_submit_')) {
      const serverId = customId.replace('captain_log_submit_', '');
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const logDate = interaction.data.components[0].components[0].value;
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/calendar/captain-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, userId, selectedDate: logDate })
      });
      
      const data = await response.json();
      return NextResponse.json({
        type: 4,
        data: { 
          content: data.success ? `📘 ${data.message}` : `❌ ${data.error}`,
          flags: 64 
        }
      });
    }
    
    if (customId.startsWith('add_mission_submit_')) {
      const serverId = customId.replace('add_mission_submit_', '');
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const components = interaction.data.components;
      
      const missionName = components[0].components[0].value;
      const missionDate = components[1].components[0].value;
      const missionTime = components[2].components[0].value;
      const missionDescription = components[3].components[0].value;
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/calendar/add-mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, userId, missionName, missionDate, missionTime, missionDescription })
      });
      
      const data = await response.json();
      return NextResponse.json({
        type: 4,
        data: { 
          content: data.success ? `🚀 ${data.message}` : `❌ ${data.error}`,
          flags: 64 
        }
      });
    }
  }

  return NextResponse.json({ error: 'Unknown interaction type' }, { status: 400 });
}
