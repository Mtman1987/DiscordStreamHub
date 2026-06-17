import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { shiftCalendarMonth } from '@/lib/calendar-discord-service-new';
import { db } from '@/lib/db';
import {
  getAppUrl,
  getChatTagApiBase,
  getDiscordClientId,
  getDiscordPublicKey,
  getHardcodedGuildId,
} from '@/lib/runtime-config';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const rawBody = await request.text();

  const publicKey = getDiscordPublicKey();
  if (!publicKey || !signature || !timestamp) {
    console.error('[Interactions] Invalid request metadata', {
      hasPublicKey: Boolean(publicKey),
      hasSignature: Boolean(signature),
      hasTimestamp: Boolean(timestamp),
    });
    return NextResponse.json({ error: 'Invalid request' }, { status: 401 });
  }

  const isValid = verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    console.error('[Interactions] Signature verification failed', {
      bodyLength: rawBody.length,
      timestamp,
    });
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

    // Partner schedule button - trigger calendar generation
    if (customId.startsWith('show_schedule_')) {
      const parts = customId.replace('show_schedule_', '').split('_');
      const serverId = parts.shift();
      const twitchLogin = parts.join('_').toLowerCase();

      if (!serverId || !twitchLogin) {
        return NextResponse.json({
          type: 4,
          data: { content: '⚠️ Could not load schedule.', flags: 64 }
        });
      }

      try {
        const userSnap = await db
          .collection('servers')
          .doc(serverId)
          .collection('users')
          .where('twitchLogin', '==', twitchLogin)
          .limit(1)
          .get();

        if (userSnap.empty) {
          return NextResponse.json({
            type: 4,
            data: { content: `⚠️ No partner calendar found for ${twitchLogin}.`, flags: 64 }
          });
        }

        const userId = userSnap.docs[0].id;
        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        const schedulePayload = await generateScheduleEmbed(userId, serverId);

        if (!schedulePayload?.embeds?.length) {
          return NextResponse.json({
            type: 4,
            data: { content: `⚠️ ${twitchLogin}'s schedule is not available right now.`, flags: 64 }
          });
        }

        return NextResponse.json({
          type: 4,
          data: {
            content: `📅 **${twitchLogin}'s Stream Schedule**`,
            embeds: schedulePayload.embeds,
            components: schedulePayload.components || [],
            flags: 64
          }
        });
      } catch (error) {
        console.error('Error generating schedule embed:', error);
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Error loading schedule. Please try again.', flags: 64 }
        });
      }
    }

    if (customId === 'link_twitch_account') {
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Link Your Twitch Account',
          custom_id: 'twitch_link_submit',
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

    if (customId === 'apply_partner') {
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Partnership Application',
          custom_id: 'partner_application_submit',
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'community_name',
                label: 'Community Name & Link',
                style: 1,
                placeholder: 'e.g. My Gaming Community - discord.gg/example',
                required: true,
                max_length: 200
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'community_focus',
                label: 'Primary Focus of Your Community',
                style: 2,
                placeholder: 'What is your community about? (gaming, streaming, etc.)',
                required: true,
                max_length: 300
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'why_partner',
                label: 'Why Partner with Space Mountain?',
                style: 2,
                placeholder: 'What makes this partnership beneficial for both communities?',
                required: true,
                max_length: 500
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'contact_info',
                label: 'Primary Contact (Owner/Admin)',
                style: 1,
                placeholder: 'Discord username of main point of contact',
                required: true,
                max_length: 100
              }]
            }
          ]
        }
      });
    }

    if (customId === 'apply_mod') {
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Mod Team Application',
          custom_id: 'mod_application_submit',
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'timezone',
                label: 'Your Timezone',
                style: 1,
                placeholder: 'e.g. EST, PST, GMT+1',
                required: true,
                max_length: 50
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'member_duration',
                label: 'How long have you been a member?',
                style: 1,
                placeholder: 'e.g. 6 months, 1 year',
                required: true,
                max_length: 100
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'why_mod',
                label: 'Why join the Mod Team?',
                style: 2,
                placeholder: 'What motivates you?',
                required: true,
                max_length: 500
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'streamers_meaning',
                label: 'Streamers supporting Streamers meaning?',
                style: 2,
                placeholder: 'In your own words...',
                required: true,
                max_length: 500
              }]
            }
          ]
        }
      });
    }

    if (customId === 'apply_admin') {
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Admin Application',
          custom_id: 'admin_application_submit',
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'discord_experience',
                label: 'Discord Moderation Experience',
                style: 2,
                placeholder: 'Describe your experience moderating Discord servers',
                required: true,
                max_length: 500
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'availability',
                label: 'Availability',
                style: 2,
                placeholder: 'When are you typically available? (timezone, hours per week)',
                required: true,
                max_length: 200
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'why_admin',
                label: 'Why do you want to be an admin?',
                style: 2,
                placeholder: 'What motivates you to help moderate this community?',
                required: true,
                max_length: 500
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'conflict_resolution',
                label: 'How would you handle conflicts?',
                style: 2,
                placeholder: 'Describe your approach to resolving disputes',
                required: true,
                max_length: 500
              }]
            }
          ]
        }
      });
    }

    // ── Forwarded message: Reply button → open modal
    if (customId.startsWith('fwd_reply_')) {
      const originKey = customId.replace('fwd_reply_', '');
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Reply to Original Message',
          custom_id: `fwd_reply_submit_${originKey}`,
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'reply_text',
                label: 'Your Reply',
                style: 2,
                placeholder: 'Type your reply here...',
                required: true,
                max_length: 2000
              }]
            }
          ]
        }
      });
    }

    // ── Forwarded message: React button → open emoji modal
    if (customId.startsWith('fwd_react_')) {
      const originKey = customId.replace('fwd_react_', '');
      return NextResponse.json({
        type: 9,
        data: {
          title: 'Send a Reaction',
          custom_id: `fwd_react_submit_${originKey}`,
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: 'emoji_input',
                label: 'Emoji to React With',
                style: 1,
                placeholder: 'Paste a single emoji',
                required: true,
                max_length: 10
              }]
            }
          ]
        }
      });
    }

    // ── Forwarded message: Remove button → defer then delete both
    if (customId.startsWith('fwd_remove_')) {
      const originKey = customId.replace('fwd_remove_', '');
      const [originGuildId, originChannelId, originMessageId] = originKey.split('_');
      const forwardedMessageId = interaction.message.id;
      const forwardedChannelId = interaction.channel_id;
      const botToken = process.env.DISCORD_BOT_TOKEN;

      // Defer the response immediately
      await fetch(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 5, data: { flags: 64 } })
      });

      // Delete forwarded message
      await fetch(`https://discord.com/api/v10/channels/${forwardedChannelId}/messages/${forwardedMessageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${botToken}` },
      }).catch(e => console.error('[FwdRemove] forwarded delete failed:', e));

      // Delete original message
      if (originChannelId && originMessageId) {
        await fetch(`https://discord.com/api/v10/channels/${originChannelId}/messages/${originMessageId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bot ${botToken}` },
        }).catch(e => console.error('[FwdRemove] original delete failed:', e));
      }

      // Clean up DB
      try {
        const homeServerId = getHardcodedGuildId() || '';
        await db.collection('servers').doc(homeServerId).collection('forwardedMessages').doc(forwardedMessageId).delete();
      } catch {}

      // Edit the deferred response
      await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${interaction.token}/messages/@original`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '🗑️ Both messages removed.' })
      });

      return new Response(null, { status: 200 });
    }

    return NextResponse.json({
      type: 4,
      data: { content: 'Button not implemented yet', flags: 64 }
    });
  }

  // Modal submission
  if (interaction.type === 5) {
    const customId = interaction.data.custom_id;
    
    // Twitch link submission
    if (customId === 'twitch_link_submit') {
      const serverId = interaction.guild_id;
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const twitchUsername = interaction.data.components[0].components[0].value.toLowerCase();
      
      if (!serverId || !userId) {
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Could not identify your Discord account.', flags: 64 }
        });
      }
      
      try {
        const { getUserRolesAndGroup } = await import('@/lib/discord-sync-service');
        const { roles, group } = await getUserRolesAndGroup(serverId, userId);
        
        await db.collection('servers').doc(serverId).collection('users').doc(userId).set({
          discordId: userId,
          twitchLogin: twitchUsername,
          roles,
          group,
          updatedAt: new Date(),
          linkedAt: new Date()
        }, { merge: true });
        
        return NextResponse.json({
          type: 4,
          data: { 
            content: `✅ Success! Your Twitch account **${twitchUsername}** is now linked as **${group}**. You'll get automatic shoutouts when you go live!`,
            flags: 64
          }
        });
      } catch (error) {
        console.error('Error linking Twitch account:', error);
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Failed to link account. Please try again.', flags: 64 }
        });
      }
    }
    
    // Partner application submission
    if (customId === 'partner_application_submit') {
      const serverId = interaction.guild_id;
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const username = interaction.member?.user?.username || interaction.user?.username;
      
      if (!serverId || !userId) {
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Could not identify your Discord account.', flags: 64 }
        });
      }
      
      try {
        const components = interaction.data.components;
        const communityName = components[0].components[0].value;
        const communityFocus = components[1].components[0].value;
        const whyPartner = components[2].components[0].value;
        const contactInfo = components[3].components[0].value;
        
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'partner',
          userId,
          username,
          communityName,
          communityFocus,
          whyPartner,
          contactInfo,
          status: 'pending',
          submittedAt: new Date()
        });
        
        return NextResponse.json({
          type: 4,
          data: { 
            content: '✅ Your partnership application has been submitted! We\'ll review it and get back to you soon. Thank you for your interest in partnering with Space Mountain!',
            flags: 64
          }
        });
      } catch (error) {
        console.error('Error submitting partner application:', error);
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Failed to submit application. Please try again.', flags: 64 }
        });
      }
    }
    
    // Mod application submission
    if (customId === 'mod_application_submit') {
      const serverId = interaction.guild_id;
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const username = interaction.member?.user?.username || interaction.user?.username;
      
      if (!serverId || !userId) {
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Could not identify your Discord account.', flags: 64 }
        });
      }
      
      try {
        const components = interaction.data.components;
        const timezone = components[0].components[0].value;
        const memberDuration = components[1].components[0].value;
        const whyMod = components[2].components[0].value;
        const streamersMeaning = components[3].components[0].value;
        
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'mod',
          userId,
          username,
          timezone,
          memberDuration,
          whyMod,
          streamersMeaning,
          status: 'pending',
          submittedAt: new Date()
        });
        
        return NextResponse.json({
          type: 4,
          data: { 
            content: '✅ Your mod team application has been submitted! We\'ll review it and get back to you soon. Thank you for your interest in helping Space Mountain!',
            flags: 64
          }
        });
      } catch (error) {
        console.error('Error submitting mod application:', error);
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Failed to submit application. Please try again.', flags: 64 }
        });
      }
    }
    
    // Admin application submission
    if (customId === 'admin_application_submit') {
      const serverId = interaction.guild_id;
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const username = interaction.member?.user?.username || interaction.user?.username;
      
      if (!serverId || !userId) {
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Could not identify your Discord account.', flags: 64 }
        });
      }
      
      try {
        const components = interaction.data.components;
        const discordExperience = components[0].components[0].value;
        const availability = components[1].components[0].value;
        const whyAdmin = components[2].components[0].value;
        const conflictResolution = components[3].components[0].value;
        
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'admin',
          userId,
          username,
          discordExperience,
          availability,
          whyAdmin,
          conflictResolution,
          status: 'pending',
          submittedAt: new Date()
        });
        
        return NextResponse.json({
          type: 4,
          data: { 
            content: '✅ Your admin application has been submitted! We\'ll review it and get back to you soon.',
            flags: 64
          }
        });
      } catch (error) {
        console.error('Error submitting admin application:', error);
        return NextResponse.json({
          type: 4,
          data: { content: '❌ Failed to submit application. Please try again.', flags: 64 }
        });
      }
    }
    
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
      
      const embed = await generateScheduleEmbed(userId, serverId);
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
      await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${interaction.token}/messages/@original`, {
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
      
      const response = await fetch(`${getAppUrl() || 'http://localhost:3000'}/api/calendar/captain-log`, {
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
    
    // ── Forwarded message: Reply modal submitted
    if (customId.startsWith('fwd_reply_submit_')) {
      const parts = customId.replace('fwd_reply_submit_', '').split('_');
      // parts: [originGuildId, originChannelId, originMessageId]
      const originChannelId = parts[1];
      const originMessageId = parts[2];
      const replyText = interaction.data.components[0].components[0].value;
      const replierName = interaction.member?.user?.username || interaction.user?.username || 'Unknown';
      const botToken = process.env.DISCORD_BOT_TOKEN;

      // Defer the response immediately
      await fetch(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 5, data: { flags: 64 } })
      });

      const replyBody: Record<string, unknown> = {
        content: `**${replierName}** replied:\n${replyText}`,
        allowed_mentions: { parse: [] },
      };
      if (originMessageId) {
        replyBody.message_reference = { message_id: originMessageId, channel_id: originChannelId };
      }

      await fetch(`https://discord.com/api/v10/channels/${originChannelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(replyBody),
      });

      // Edit the deferred response
      await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${interaction.token}/messages/@original`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '✅ Reply sent to the original channel!' })
      });

      return new Response(null, { status: 200 });
    }

    // ── Forwarded message: React modal submitted
    if (customId.startsWith('fwd_react_submit_')) {
      const parts = customId.replace('fwd_react_submit_', '').split('_');
      const originChannelId = parts[1];
      const originMessageId = parts[2];
      const emoji = interaction.data.components[0].components[0].value.trim();
      const botToken = process.env.DISCORD_BOT_TOKEN;

      // Defer the response immediately
      await fetch(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 5, data: { flags: 64 } })
      });

      const encoded = encodeURIComponent(emoji);
      await fetch(
        `https://discord.com/api/v10/channels/${originChannelId}/messages/${originMessageId}/reactions/${encoded}/@me`,
        { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } },
      );

      // Edit the deferred response
      await fetch(`https://discord.com/api/v10/webhooks/${getDiscordClientId()}/${interaction.token}/messages/@original`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `✅ Reacted with ${emoji}!` })
      });

      return new Response(null, { status: 200 });
    }

    if (customId.startsWith('add_mission_submit_')) {
      const serverId = customId.replace('add_mission_submit_', '');
      const userId = interaction.member?.user?.id || interaction.user?.id;
      const components = interaction.data.components;
      
      const missionName = components[0].components[0].value;
      const missionDate = components[1].components[0].value;
      const missionTime = components[2].components[0].value;
      const missionDescription = components[3].components[0].value;
      
      const response = await fetch(`${getAppUrl() || 'http://localhost:3000'}/api/calendar/add-mission`, {
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
