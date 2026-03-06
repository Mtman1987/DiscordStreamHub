import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';
import { submitCaptainLog, submitMission } from '@/lib/calendar-admin-actions';
import { shiftCalendarMonth } from '@/lib/calendar-discord-service';
import { format } from 'date-fns';

function extractValues(components: any[] = []) {
  const values: Record<string, string> = {};
  components.forEach(row => {
    row.components?.forEach((component: any) => {
      values[component.custom_id] = component.value;
    });
  });
  return values;
}

function ephemeral(content: string, extra: any = {}) {
  return NextResponse.json({
    type: 4,
    data: { content, flags: 64, ...extra },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.type === 1) {
      return NextResponse.json({ type: 1 });
    }

    const customId: string | undefined = body.data?.custom_id;

    if (body.type === 3 && customId) {
      if (customId.startsWith('partner_schedule_refresh_')) {
        const parts = customId.replace('partner_schedule_refresh_', '').split('_');
        const userId = parts[0];
        const serverId = parts[1];

        // Re-fetch Twitch schedule
        const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        if (userData?.twitchId) {
          const { fetchTwitchSchedule } = await import('@/lib/partner-schedule-service');
          const segments = await fetchTwitchSchedule(userData.twitchId, '');
          
          const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents');
          const batch = db.batch();
          
          // Clear only Twitch events
          const oldTwitchEvents = await eventsRef.where('type', '==', 'stream').get();
          oldTwitchEvents.docs.forEach(doc => batch.delete(doc.ref));
          
          // Add new Twitch events
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
        }

        // Re-fetch Google Calendar if URL exists
        const googleUrlDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
        const googleIcalUrl = googleUrlDoc.data()?.googleIcalUrl;
        
        if (googleIcalUrl) {
          try {
            const response = await fetch(googleIcalUrl);
            if (response.ok) {
              const icalData = await response.text();
              const events: any[] = [];
              const eventBlocks = icalData.split('BEGIN:VEVENT');
              
              for (let i = 1; i < eventBlocks.length && i <= 25; i++) {
                const block = eventBlocks[i];
                const summaryMatch = block.match(/SUMMARY:(.+)/);
                const startMatch = block.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
                
                if (summaryMatch && startMatch) {
                  const dateStr = startMatch[1];
                  const year = dateStr.substring(0, 4);
                  const month = dateStr.substring(4, 6);
                  const day = dateStr.substring(6, 8);
                  const hour = dateStr.substring(9, 11);
                  const minute = dateStr.substring(11, 13);
                  
                  events.push({
                    eventName: summaryMatch[1].trim(),
                    description: 'Google Calendar',
                    eventDateTime: new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`),
                    type: 'google',
                    isRecurring: false
                  });
                }
              }

              const batch = db.batch();
              const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(userId).collection('scheduleEvents');
              
              // Clear old Google events
              const oldGoogleEvents = await eventsRef.where('type', '==', 'google').get();
              oldGoogleEvents.docs.forEach(doc => batch.delete(doc.ref));
              
              // Add new Google events
              events.forEach(event => {
                const docRef = eventsRef.doc();
                batch.set(docRef, event);
              });
              
              await batch.commit();
            }
          } catch (error) {
            console.error('[PartnerRefresh] Failed to refresh Google Calendar:', error);
          }
        }

        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        const embed = await generateScheduleEmbed(userId, serverId);

        if (embed) {
          const messageId = body.message?.id;
          const channelId = body.channel_id;
          const botToken = process.env.DISCORD_BOT_TOKEN;

          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(embed)
          });

          return ephemeral('✅ Calendar refreshed with latest Twitch and Google data!');
        }
        return ephemeral('⚠️ Failed to refresh calendar.');
      }

      if (customId.startsWith('partner_schedule_add_')) {
        const parts = customId.replace('partner_schedule_add_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const clickerId = body.member?.user?.id || body.user?.id;

        if (clickerId !== ownerId) {
          return ephemeral('🚫 Only the calendar owner can add events.');
        }

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `partner_schedule_add_modal_${ownerId}_${serverId}`,
            title: 'Add Custom Event',
            components: [
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'event_name',
                  label: 'Event Name',
                  style: 1,
                  required: true,
                  max_length: 80
                }]
              },
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'event_date',
                  label: 'Date (YYYY-MM-DD)',
                  style: 1,
                  required: true,
                  value: format(new Date(), 'yyyy-MM-dd')
                }]
              },
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'event_time',
                  label: 'Time (HH:MM)',
                  style: 1,
                  required: true,
                  value: '12:00'
                }]
              }
            ]
          }
        });
      }

      if (customId.startsWith('partner_schedule_seturl_')) {
        const parts = customId.replace('partner_schedule_seturl_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const clickerId = body.member?.user?.id || body.user?.id;

        if (clickerId !== ownerId) {
          return ephemeral('🚫 Only the calendar owner can sync calendars.');
        }

        return ephemeral('📅 **How to sync Google Calendar:**\n\n1. Go to [Google Calendar Settings](https://calendar.google.com/calendar/u/0/r/settings)\n2. Click on your calendar name\n3. Scroll to "Integrate calendar"\n4. Copy the **Secret address in iCal format**\n5. Click the button below and paste the URL\n\n⚠️ Keep this URL private - anyone with it can see your calendar!', {
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 5,
              label: '🔗 Open Google Calendar Settings',
              url: 'https://calendar.google.com/calendar/u/0/r/settings'
            }, {
              type: 2,
              style: 1,
              label: '📝 Paste iCal URL',
              custom_id: `partner_paste_ical_${ownerId}_${serverId}`
            }]
          }]
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

      if (customId.startsWith('partner_schedule_username_')) {
        const parts = customId.replace('partner_schedule_username_', '').split('_');
        const userId = parts[0];
        const serverId = parts[1];
        const threadId = parts[2];

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `partner_schedule_modal_${userId}_${serverId}_${threadId}`,
            title: 'Connect Twitch Schedule',
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'twitch_username',
                    label: 'Twitch Username',
                    style: 1,
                    min_length: 3,
                    max_length: 25,
                    required: true,
                    placeholder: 'Enter your Twitch username'
                  },
                ],
              },
            ],
          },
        });
      }

      if (customId.startsWith('calendar_captain_log_')) {
        const serverId = customId.replace('calendar_captain_log_', '');
        const todayIso = new Date().toISOString().slice(0, 10);

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `calendar_captain_log_modal_${serverId}`,
            title: "Captain's Log Signup",
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'log_date',
                    label: 'Flight Date (YYYY-MM-DD)',
                    style: 1,
                    min_length: 10,
                    max_length: 10,
                    required: true,
                    value: todayIso,
                  },
                ],
              },
            ],
          },
        });
      }

      if (customId.startsWith('calendar_add_mission_')) {
        const serverId = customId.replace('calendar_add_mission_', '');
        const todayIso = new Date().toISOString().slice(0, 10);

        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `calendar_add_mission_modal_${serverId}`,
            title: 'Add Mission',
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_name',
                    label: 'Mission Name',
                    style: 1,
                    min_length: 3,
                    max_length: 80,
                    required: true,
                  },
                ],
              },
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_description',
                    label: 'Mission Briefing',
                    style: 2,
                    min_length: 5,
                    max_length: 400,
                    required: true,
                  },
                ],
              },
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_date',
                    label: 'Date (YYYY-MM-DD)',
                    style: 1,
                    min_length: 10,
                    max_length: 10,
                    required: true,
                    value: todayIso,
                  },
                ],
              },
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: 'mission_time',
                    label: 'Time (HH:MM, optional)',
                    style: 1,
                    min_length: 0,
                    max_length: 5,
                    required: false,
                  },
                ],
              },
            ],
          },
        });
      }

      if (customId.startsWith('calendar_prev_month_')) {
        const serverId = customId.replace('calendar_prev_month_', '');
        const result = await shiftCalendarMonth(serverId, -1);
        return ephemeral(
          result.success
            ? `📅 Calendar shifted to **${result.monthLabel}**`
            : `⚠️ ${result.message ?? 'Unable to update calendar.'}`
        );
      }

      if (customId.startsWith('calendar_next_month_')) {
        const serverId = customId.replace('calendar_next_month_', '');
        const result = await shiftCalendarMonth(serverId, 1);
        return ephemeral(
          result.success
            ? `📅 Calendar shifted to **${result.monthLabel}**`
            : `⚠️ ${result.message ?? 'Unable to update calendar.'}`
        );
      }

      if (customId.startsWith('check_rank_')) {
        const serverId = customId.replace('check_rank_', '');
        const userId = body.member?.user?.id || body.user?.id;
        const username = body.member?.user?.username || body.user?.username;

        if (!userId) {
          return ephemeral('🚫 Unable to identify user.');
        }

        const leaderboardRef = db.collection('servers').doc(serverId).collection('leaderboard');
        const userDoc = await leaderboardRef.doc(userId).get();

        if (!userDoc.exists) {
          return ephemeral(`🛰️ **${username}**, you haven't earned any points yet! Start participating to climb the leaderboard! 🚀`);
        }

        const userData = userDoc.data();
        const userPoints = userData?.points || 0;
        const higherRankedSnapshot = await leaderboardRef.where('points', '>', userPoints).get();
        const rank = higherRankedSnapshot.size + 1;

        return ephemeral(`📊 **${username}**, you are rank #${rank} with ${userPoints.toLocaleString()} points!\n\n${rank <= 10 ? '🏆 You’re in the top 10! Great job!' : '🔭 Keep earning points to climb higher!'}`);
      }
    }

    if (body.type === 5 && customId) {
      const userId = body.member?.user?.id || body.user?.id;
      if (!userId) {
        return ephemeral('🚫 Unable to identify user.');
      }

      if (customId.startsWith('partner_schedule_add_modal_')) {
        const parts = customId.replace('partner_schedule_add_modal_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const values = extractValues(body.data?.components);

        const eventDateTime = new Date(`${values.event_date}T${values.event_time}`);
        await db.collection('servers').doc(serverId).collection('users').doc(ownerId).collection('scheduleEvents').add({
          eventName: values.event_name,
          description: 'Custom Event',
          eventDateTime,
          type: 'custom',
          isRecurring: false
        });

        // Auto-refresh calendar
        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        const embed = await generateScheduleEmbed(ownerId, serverId);

        if (embed) {
          const messageId = body.message?.id;
          const channelId = body.channel_id;
          const botToken = process.env.DISCORD_BOT_TOKEN;

          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(embed)
          });
        }

        return ephemeral('✅ Event added and calendar refreshed!');
      }

      if (customId.startsWith('partner_schedule_seturl_modal_')) {
        const parts = customId.replace('partner_schedule_seturl_modal_', '').split('_');
        const ownerId = parts[0];
        const serverId = parts[1];
        const values = extractValues(body.data?.components);
        const icalUrl = values.google_ical_url;

        try {
          const response = await fetch(icalUrl);
          if (!response.ok) throw new Error('Invalid iCal URL');
          
          const icalData = await response.text();
          const events: any[] = [];
          const eventBlocks = icalData.split('BEGIN:VEVENT');
          
          for (let i = 1; i < eventBlocks.length && i <= 25; i++) {
            const block = eventBlocks[i];
            const summaryMatch = block.match(/SUMMARY:(.+)/);
            const startMatch = block.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
            
            if (summaryMatch && startMatch) {
              const dateStr = startMatch[1];
              const year = dateStr.substring(0, 4);
              const month = dateStr.substring(4, 6);
              const day = dateStr.substring(6, 8);
              const hour = dateStr.substring(9, 11);
              const minute = dateStr.substring(11, 13);
              
              events.push({
                eventName: summaryMatch[1].trim(),
                description: 'Google Calendar',
                eventDateTime: new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`),
                type: 'google',
                isRecurring: false
              });
            }
          }

          const batch = db.batch();
          const eventsRef = db.collection('servers').doc(serverId).collection('users').doc(ownerId).collection('scheduleEvents');
          
          events.forEach(event => {
            const docRef = eventsRef.doc();
            batch.set(docRef, event);
          });
          
          await batch.commit();

          // Store Google iCal URL for future refreshes
          await db.collection('servers').doc(serverId).collection('users').doc(ownerId).update({
            googleIcalUrl: icalUrl
          });

          // Auto-refresh calendar
          const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
          const embed = await generateScheduleEmbed(ownerId, serverId);

          if (embed) {
            const messageId = body.message?.id;
            const channelId = body.channel_id;
            const botToken = process.env.DISCORD_BOT_TOKEN;

            await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(embed)
          });
          }

          return ephemeral(`✅ Synced ${events.length} events from Google Calendar and refreshed!`);
        } catch (error) {
          return ephemeral('⚠️ Invalid Google Calendar URL. Make sure it\'s the iCal format.');
        }
      }

      if (customId.startsWith('partner_schedule_modal_')) {
        const parts = customId.replace('partner_schedule_modal_', '').split('_');
        const userId = parts[0];
        const serverId = parts[1];
        const threadId = parts[2];
        const values = extractValues(body.data?.components);
        const twitchUsername = values.twitch_username;

        console.log('[PartnerUsername] Storing username:', twitchUsername, 'for user:', userId);

        await db.collection('servers').doc(serverId).collection('users').doc(userId).update({
          twitchLogin: twitchUsername
        });

        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        console.log('[PartnerUsername] Generating schedule embed...');
        const embed = await generateScheduleEmbed(userId, serverId);
        console.log('[PartnerUsername] Embed generated:', !!embed);

        if (embed) {
          console.log('[PartnerUsername] Posting to thread:', threadId);
          const { postDiscordMessage } = await import('@/lib/discord-sync-service');
          await postDiscordMessage(serverId, threadId, embed);
          console.log('[PartnerUsername] Calendar posted successfully!');
          return ephemeral('✅ Your stream schedule calendar has been posted!');
        } else {
          return ephemeral('⚠️ Failed to generate calendar. Please try again.');
        }
      }

      if (customId.startsWith('calendar_captain_log_modal_')) {
        const serverId = customId.replace('calendar_captain_log_modal_', '');
        const values = extractValues(body.data?.components);
        const result = await submitCaptainLog({
          serverId,
          userId,
          selectedDate: values.log_date,
        });
        return ephemeral(result.success ? `✅ ${result.message}` : `⚠️ ${result.error || 'Failed to save captain log.'}`);
      }

      if (customId.startsWith('calendar_add_mission_modal_')) {
        const serverId = customId.replace('calendar_add_mission_modal_', '');
        const values = extractValues(body.data?.components);
        const result = await submitMission({
          serverId,
          userId,
          missionName: values.mission_name,
          missionDescription: values.mission_description,
          missionDate: values.mission_date,
          missionTime: values.mission_time,
        });
        return ephemeral(result.success ? `✅ ${result.message}` : `⚠️ ${result.error || 'Failed to add mission.'}`);
      }
    }

    return NextResponse.json({ error: 'Unknown interaction' }, { status: 400 });
  } catch (error) {
    console.error('Discord interaction error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
