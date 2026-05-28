import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { db } from '@/lib/db';
import { submitCaptainLog, submitMission } from '@/lib/calendar-admin-actions';
import { shiftCalendarMonth } from '@/lib/calendar-discord-service-new';
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

const CHAT_TAG_SERVICE_SECRET = process.env.CHAT_TAG_BOT_SECRET || process.env.BOT_SECRET_KEY || '1234';
const HMO_WATCH_SESSION_ID = 'discord-watch-room';

function getHearMeOutUrl() {
  return (process.env.HEARMEOUT_URL || 'https://hearmeout-main.fly.dev').replace(/\/$/, '');
}

async function runHearMeOutWatchControl(action: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = `${getHearMeOutUrl()}/api/watch/sessions/${HMO_WATCH_SESSION_ID}/quick-control?action=${encodeURIComponent(action)}&format=json`;
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, message: payload?.error || `HearMeOut returned ${response.status}` };
    }

    const title = payload?.session?.current?.item?.title || 'watch room';
    const status = payload?.session?.playback?.status || 'updated';
    const label = action === 'next' ? 'Skipped' : action === 'clear' ? 'Cleared' : action[0].toUpperCase() + action.slice(1);
    return { ok: true, message: `${label}: **${title}** (${status})` };
  } catch (error: any) {
    return { ok: false, message: error?.name === 'AbortError' ? 'HearMeOut timed out.' : 'HearMeOut control request failed.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function updateDeferredInteraction(applicationId: string, token: string, content: string) {
  if (!applicationId || !token) return;
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch((error) => {
    console.error('[DiscordInteractions] Failed to update HearMeOut control response:', error);
  });
}

export async function POST(request: NextRequest) {
  try {
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

    const body = JSON.parse(rawBody);

    if (body.type === 1) {
      return NextResponse.json({ type: 1 });
    }

    const customId: string | undefined = body.data?.custom_id;

    if (body.type === 3 && customId) {
      if (customId.startsWith('hmo_watch_control:')) {
        const action = customId.split(':')[1] || '';
        const applicationId = body.application_id || process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APP_ID;
        runHearMeOutWatchControl(action)
          .then((result) => updateDeferredInteraction(applicationId, body.token, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`))
          .catch((error) => updateDeferredInteraction(applicationId, body.token, `❌ ${error?.message || 'HearMeOut control request failed.'}`));

        return NextResponse.json({
          type: 5,
          data: { content: 'Sending control to HearMeOut...', flags: 64 },
        });
      }

      // ── Chat Tag button interactions ──
      if (customId.startsWith('chattag_')) {
        const serverId = body.guild_id || process.env.HARDCODED_GUILD_ID;
        const clickerId = body.member?.user?.id || body.user?.id;
        const clickerName = body.member?.user?.username || body.user?.username || 'Unknown';

        if (customId.startsWith('chattag_score_')) {
          const { fetchTagData, buildScoreEmbed } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          const data = await fetchTagData();
          const players = data?.players || [];
          const player = twitchLogin
            ? players.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin)
            : null;
          const sorted = [...players].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
          const rank = player ? sorted.findIndex((p: any) => p.id === player.id) + 1 : 0;
          return ephemeral(buildScoreEmbed(player, rank, sorted.length));
        }

        if (customId.startsWith('chattag_join_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          const joinName = twitchLogin || clickerName.toLowerCase();
          const data = await fetchTagData();
          const existing = data?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === joinName);
          if (existing) return ephemeral(`✅ You're already in the game as ${joinName}!`);
          const { default: postTagApi } = await import('@/lib/chat-tag-service').then(m => ({ default: (e: string, b: any) => fetch(`${process.env.CHAT_TAG_API_BASE || 'https://chat-tag-new.fly.dev'}${e}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-secret': CHAT_TAG_SERVICE_SECRET }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => null) }));
          const res = await postTagApi('/api/tag', { action: 'join', userId: `discord_${clickerId}`, twitchUsername: joinName, avatar: '' });
          return ephemeral(res?.error ? `❌ ${res.error}` : `🎯 You joined the tag game as ${joinName}!`);
        }

        if (customId.startsWith('chattag_status_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const data = await fetchTagData();
          const itPlayer = data?.players?.find((p: any) => p.isIt);
          const itName = itPlayer ? (itPlayer.twitchUsername || 'Someone') : null;
          return ephemeral(itName ? `🎯 **${itName}** is it!` : `🔥 **FREE FOR ALL!** Anyone can tag for DOUBLE POINTS!`);
        }

        if (customId.startsWith('chattag_leaderboard_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const data = await fetchTagData();
          const players = [...(data?.players || [])]
            .filter((p: any) => (p.twitchUsername || p.username))
            .sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
          const lines = players.slice(0, 25).map((p: any, index: number) => {
            const name = p.twitchUsername || p.username || p.id || 'Unknown';
            return `**#${index + 1}** ${name} — ${p.score || 0} pts (${p.tags || 0} tags, ${p.tagged || 0} tagged)`;
          });
          return ephemeral(lines.length ? `🏆 **Full Chat Tag Leaderboard**\n${lines.join('\n')}` : 'No leaderboard data yet.');
        }

        if (customId.startsWith('chattag_togglesleep_')) {
          const { fetchTagData } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          if (!twitchLogin) return ephemeral('❌ Link your Twitch account first.');
          const data = await fetchTagData();
          const player = data?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin);
          if (!player) return ephemeral('❌ You\'re not in the tag game. Use the Join button first.');
          const isSleeping = player.sleepingImmunity || player.offlineImmunity;
          const action = isSleeping ? 'wake' : 'sleep';
          await fetch(`${process.env.CHAT_TAG_API_BASE || 'https://chat-tag-new.fly.dev'}/api/tag`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-secret': CHAT_TAG_SERVICE_SECRET },
            body: JSON.stringify({ action, userId: player.id }),
          });
          return ephemeral(isSleeping ? `☀️ You're awake! You can be tagged again.` : `😴 You're now sleeping (immune from tags).`);
        }

        if (customId.startsWith('chattag_bingo_')) {
          const { fetchGameState, buildBingoComponents, buildBingoPhrasesList } = await import('@/lib/chat-tag-service');
          const gs = await fetchGameState();
          const bingoPayload = buildBingoComponents(gs?.bingo, serverId);
          // Add phrases as content prefix (truncated to fit)
          const phrases = buildBingoPhrasesList(gs?.bingo);
          const phrasesPreview = phrases.length > 1500 ? phrases.slice(0, 1500) + '...' : phrases;
          return NextResponse.json({
            type: 4,
            data: { content: `${bingoPayload.content}\n\n${phrasesPreview}`, components: bingoPayload.components, flags: 64 },
          });
        }

        if (customId.startsWith('chattag_claim_')) {
          const parts = customId.split('_');
          const squareIndex = parseInt(parts[parts.length - 1]);
          if (isNaN(squareIndex)) return ephemeral('❌ Invalid square.');
          const { claimBingoSquare, fetchGameState, buildBingoComponents } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          const claimUserId = twitchLogin || `discord_${clickerId}`;
          const res = await claimBingoSquare(squareIndex, claimUserId, twitchLogin || clickerName);
          if (res?.error) return ephemeral(`❌ ${res.error}`);
          const gs = await fetchGameState();
          const updated = buildBingoComponents(gs?.bingo, serverId);
          const bingoMsg = res?.bingo ? '🎉 **BINGO!** +100 points!' : `✅ Claimed square ${squareIndex}!`;
          return NextResponse.json({
            type: 7,
            data: { content: `${bingoMsg}\n\n${updated.content}`, components: updated.components, flags: 64 },
          });
        }

        if (customId.startsWith('chattag_admin_')) {
          const { fetchGameState, buildAdminEmbed } = await import('@/lib/chat-tag-service');
          const gs = await fetchGameState();
          const adminPayload = buildAdminEmbed(gs, serverId);
          return NextResponse.json({ type: 4, data: adminPayload });
        }

        if (customId.startsWith('chattag_makemeit_')) {
          const { setMeAsIt, fetchTagData, postOrUpdateGameEmbed } = await import('@/lib/chat-tag-service');
          const twitchLogin = await (async () => {
            try {
              const doc = await db.collection('servers').doc(serverId).collection('users').doc(clickerId).get();
              return doc.data()?.twitchLogin?.toLowerCase() || null;
            } catch { return null; }
          })();
          if (!twitchLogin) return ephemeral('❌ Link your Twitch account first.');
          const data = await fetchTagData();
          const player = data?.players?.find((p: any) => (p.twitchUsername || '').toLowerCase() === twitchLogin);
          if (!player) return ephemeral('❌ You\'re not in the tag game.');
          await setMeAsIt(player.id);
          await postOrUpdateGameEmbed(serverId).catch((error) => {
            console.error('[ChatTag] Failed to refresh embed after Make Me IT:', error);
          });
          return ephemeral(`✅ ${clickerName} is now IT!`);
        }

        if (customId.startsWith('chattag_clearimmunity_')) {
          const { clearAllImmunity, postOrUpdateGameEmbed } = await import('@/lib/chat-tag-service');
          await clearAllImmunity();
          await postOrUpdateGameEmbed(serverId).catch((error) => {
            console.error('[ChatTag] Failed to refresh embed after clearing immunity:', error);
          });
          return ephemeral('✅ All immunity cleared!');
        }

        if (customId.startsWith('chattag_triggerffa_')) {
          const { triggerFreeForAll, postOrUpdateGameEmbed } = await import('@/lib/chat-tag-service');
          await triggerFreeForAll();
          await postOrUpdateGameEmbed(serverId).catch((error) => {
            console.error('[ChatTag] Failed to refresh embed after FFA:', error);
          });
          return ephemeral('🔥 Free-for-all triggered. Anyone can tag for double points.');
        }

        if (customId.startsWith('chattag_newcard_')) {
          const { generateNewBingoCard } = await import('@/lib/chat-tag-service');
          const res = await generateNewBingoCard();
          const note = res?.aiGenerated ? '(AI-generated!)' : '(shuffled phrases)';
          return ephemeral(`✅ New bingo card generated ${note}!`);
        }

        if (customId.startsWith('chattag_logs_')) {
          const { fetchLogs } = await import('@/lib/chat-tag-service');
          const logs = await fetchLogs();
          const logsUrl = `${process.env.CHAT_TAG_API_BASE || 'https://chat-tag-new.fly.dev'}/api/logs`;
          return ephemeral(`📋 **Recent Logs:**\n\`\`\`\n${logs}\n\`\`\`\n🔗 [Live Logs](${logsUrl})`);
        }
      }

      if (customId === 'link_twitch_account') {
        // Generic button — need to get serverId from guild_id
        const serverId = body.guild_id;
        if (!serverId) {
          return ephemeral('⚠️ Could not determine server. Please try again.');
        }
        const userId = body.member?.user?.id || body.user?.id;
        const botToken = process.env.DISCORD_BOT_TOKEN;
        
        const guildMemberRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/members/${userId}`, {
          headers: { 'Authorization': `Bot ${botToken}` }
        });
        
        if (!guildMemberRes.ok) {
          return ephemeral('⚠️ Failed to fetch your Discord info.');
        }
        
        const memberData = await guildMemberRes.json();
        const roles = memberData.roles || [];
        
        const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        const serverDoc = await db.collection('servers').doc(serverId).get();
        const roleMappings = serverDoc.data()?.roleMappings || {};
        let group = 'Community';
        for (const [roleId, groupName] of Object.entries(roleMappings)) {
          if (roles.includes(roleId)) {
            group = groupName as string;
            break;
          }
        }
        
        await db.collection('servers').doc(serverId).collection('users').doc(userId).set({
          discordUserId: userId,
          username: memberData.user.username,
          avatarUrl: memberData.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${userId}/${memberData.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png',
          roles,
          group,
          isOnline: false
        }, { merge: true });
        
        if (userData?.twitchLogin) {
          return ephemeral(`✅ Account updated!\n\nTwitch: **${userData.twitchLogin}**\nGroup: **${group}**\n\nYou're all set for shoutouts!`);
        }
        
        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `link_twitch_modal_${serverId}`,
            title: 'Link Your Twitch Account',
            components: [
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'twitch_username',
                  label: 'Twitch Username',
                  style: 1,
                  required: true,
                  min_length: 3,
                  max_length: 25,
                  placeholder: 'Enter your Twitch username'
                }]
              }
            ]
          }
        });
      }

      if (customId.startsWith('link_twitch_') && customId !== 'link_twitch_account') {
        const serverId = customId.replace('link_twitch_', '');
        const userId = body.member?.user?.id || body.user?.id;
        const botToken = process.env.DISCORD_BOT_TOKEN;
        
        // Always fetch fresh Discord data
        const guildMemberRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/members/${userId}`, {
          headers: { 'Authorization': `Bot ${botToken}` }
        });
        
        if (!guildMemberRes.ok) {
          return ephemeral('⚠️ Failed to fetch your Discord info.');
        }
        
        const memberData = await guildMemberRes.json();
        const roles = memberData.roles || [];
        
        // Check existing user data
        const userDoc = await db.collection('servers').doc(serverId).collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        // Determine group from roles
        const serverDoc = await db.collection('servers').doc(serverId).get();
        const roleMappings = serverDoc.data()?.roleMappings || {};
        let group = 'Community';
        for (const [roleId, groupName] of Object.entries(roleMappings)) {
          if (roles.includes(roleId)) {
            group = groupName as string;
            break;
          }
        }
        
        // Update Discord data regardless
        await db.collection('servers').doc(serverId).collection('users').doc(userId).set({
          discordUserId: userId,
          username: memberData.user.username,
          avatarUrl: memberData.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${userId}/${memberData.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png',
          roles,
          group,
          isOnline: false
        }, { merge: true });
        
        // Check if Twitch is linked
        if (userData?.twitchLogin) {
          return ephemeral(`✅ Account updated!\n\nTwitch: **${userData.twitchLogin}**\nGroup: **${group}**\n\nYou're all set for shoutouts!`);
        }
        
        // Need Twitch username
        return NextResponse.json({
          type: 9,
          data: {
            custom_id: `link_twitch_modal_${serverId}`,
            title: 'Link Your Twitch Account',
            components: [
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'twitch_username',
                  label: 'Twitch Username',
                  style: 1,
                  required: true,
                  min_length: 3,
                  max_length: 25,
                  placeholder: 'Enter your Twitch username'
                }]
              }
            ]
          }
        });
      }
      
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
        const embed = await generateScheduleEmbed(userId, serverId, { 
          channelId: body.channel_id, 
          messageId: body.message?.id 
        });

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
        // Defer immediately — calendar generation takes time
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await shiftCalendarMonth(serverId, -1);
            const msg = result.success
              ? `📅 Calendar shifted to **${(result as any).monthLabel}**`
              : `⚠️ ${(result as any).message ?? 'Unable to update calendar.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] calendar_prev_month error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      if (customId.startsWith('calendar_next_month_')) {
        const serverId = customId.replace('calendar_next_month_', '');
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await shiftCalendarMonth(serverId, 1);
            const msg = result.success
              ? `📅 Calendar shifted to **${(result as any).monthLabel}**`
              : `⚠️ ${(result as any).message ?? 'Unable to update calendar.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] calendar_next_month error:', e);
          }
        });
        return new Response(null, { status: 202 });
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

      if (customId.startsWith('points_info_')) {
        const serverId = customId.replace('points_info_', '');
        const settingsDoc = await db.collection('servers').doc(serverId).collection('config').doc('leaderboardSettings').get();
        const s = settingsDoc.data() || {};
        return ephemeral(
          `**🏆 How Points Work**\n\n` +
          `**Twitch Activity:**\n` +
          `💬 Chat Message: **${s.chatActivityPoints ?? 1}** pts (1 per 5 min)\n` +
          `🌟 Subscription: **${s.subPoints ?? 50}** pts\n` +
          `🎁 Gift Sub: **${s.giftedSubPoints ?? 25}** pts\n` +
          `💎 Bits: **${s.bitPoints ?? 1}** pt per bit\n` +
          `🚀 Raid: **${s.raidPoints ?? 10}** pts\n\n` +
          `**Discord Activity:**\n` +
          `💬 Message: **${s.chatActivityPoints ?? 1}** pts (1 per 5 min)\n\n` +
          `**Admin Actions:**\n` +
          `📅 Calendar Event: **${s.adminEventPoints ?? 10}** pts\n` +
          `📘 Captain's Log: **${s.adminLogPoints ?? 5}** pts\n\n` +
          `*Keep chatting, subbing, and raiding to climb the leaderboard!*`
        );
      }

      if (customId.startsWith('crew_schedule_') || customId.startsWith('partner_schedule_')) {
        const twitchLogin = customId.replace(/^(crew|partner)_schedule_/, '').toLowerCase();
        const serverId = body.guild_id;

        if (!serverId || !twitchLogin) {
          return ephemeral('⚠️ Could not load schedule.');
        }

        const userSnap = await db
          .collection('servers')
          .doc(serverId)
          .collection('users')
          .where('twitchLogin', '==', twitchLogin)
          .limit(1)
          .get();

        if (userSnap.empty) {
          return ephemeral(`⚠️ No schedule found for ${twitchLogin}.`);
        }

        const userId = userSnap.docs[0].id;
        const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
        const schedulePayload = await generateScheduleEmbed(userId, serverId);

        if (!schedulePayload?.embeds?.length) {
          return ephemeral(`⚠️ ${twitchLogin}'s schedule is not available right now.`);
        }

        return ephemeral(`📅 ${twitchLogin}'s stream schedule`, {
          embeds: schedulePayload.embeds
        });
      }

      if (customId.startsWith('show_schedule_')) {
        const parts = customId.replace('show_schedule_', '').split('_');
        const serverId = parts.shift();
        const twitchLogin = parts.join('_').toLowerCase();

        if (!serverId || !twitchLogin) {
          return ephemeral('⚠️ Could not load schedule.');
        }

        // Defer immediately — schedule generation can be slow
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const userSnap = await db
              .collection('servers').doc(serverId)
              .collection('users').where('twitchLogin', '==', twitchLogin).limit(1).get();

            let msg: any = { content: `⚠️ No schedule found for ${twitchLogin}.` };
            if (!userSnap.empty) {
              const userId = userSnap.docs[0].id;
              const { generateScheduleEmbed } = await import('@/lib/partner-schedule-service');
              const schedulePayload = await generateScheduleEmbed(userId, serverId);
              if (schedulePayload?.embeds?.length) {
                msg = { content: `📅 ${twitchLogin}'s stream schedule`, embeds: schedulePayload.embeds };
              } else {
                msg = { content: `⚠️ ${twitchLogin}'s schedule is not available right now.` };
              }
            }
            await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg)
            });
          } catch (e) {
            console.error('[Interactions] show_schedule error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      // ── Forwarded message buttons ──
      if (customId.startsWith('fwd_reply_')) {
        const originKey = customId.replace('fwd_reply_', '');
        return NextResponse.json({
          type: 9,
          data: {
            title: 'Reply to Original Message',
            custom_id: `fwd_reply_submit_${originKey}`,
            components: [{ type: 1, components: [{ type: 4, custom_id: 'reply_text', label: 'Your Reply', style: 2, placeholder: 'Type your reply here...', required: true, max_length: 2000 }] }]
          }
        });
      }

      if (customId.startsWith('fwd_react_')) {
        const originKey = customId.replace('fwd_react_', '');
        return NextResponse.json({
          type: 9,
          data: {
            title: 'Send a Reaction',
            custom_id: `fwd_react_submit_${originKey}`,
            components: [{ type: 1, components: [{ type: 4, custom_id: 'emoji_input', label: 'Emoji to React With', style: 1, placeholder: 'Paste a single emoji', required: true, max_length: 10 }] }]
          }
        });
      }

      if (customId.startsWith('fwd_remove_')) {
        const originKey = customId.replace('fwd_remove_', '');
        const [, originChannelId, originMessageId] = originKey.split('_');
        const forwardedMessageId = body.message.id;
        const forwardedChannelId = body.channel_id;
        const botToken = process.env.DISCORD_BOT_TOKEN;

        await fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        });

        await fetch(`https://discord.com/api/v10/channels/${forwardedChannelId}/messages/${forwardedMessageId}`, {
          method: 'DELETE', headers: { Authorization: `Bot ${botToken}` },
        }).catch(e => console.error('[FwdRemove] forwarded delete failed:', e));

        if (originChannelId && originMessageId) {
          await fetch(`https://discord.com/api/v10/channels/${originChannelId}/messages/${originMessageId}`, {
            method: 'DELETE', headers: { Authorization: `Bot ${botToken}` },
          }).catch(e => console.error('[FwdRemove] original delete failed:', e));
        }

        try {
          const homeServerId = process.env.HARDCODED_GUILD_ID || process.env.GUILD_ID || '';
          await db.collection('servers').doc(homeServerId).collection('forwardedMessages').doc(forwardedMessageId).delete();
        } catch {}

        await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${body.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '🗑️ Both messages removed.' })
        });

        return new Response(null, { status: 200 });
      }

      if (customId === 'apply_partner') {
        return NextResponse.json({
          type: 9,
          data: {
            title: 'Partnership Application',
            custom_id: 'partner_application_submit',
            components: [
              { type: 1, components: [{ type: 4, custom_id: 'community_name', label: 'Community Name & Link', style: 1, placeholder: 'e.g. My Gaming Community - discord.gg/example', required: true, max_length: 200 }] },
              { type: 1, components: [{ type: 4, custom_id: 'community_focus', label: 'Primary Focus of Your Community', style: 2, placeholder: 'What is your community about?', required: true, max_length: 300 }] },
              { type: 1, components: [{ type: 4, custom_id: 'why_partner', label: 'Why Partner with Space Mountain?', style: 2, placeholder: 'What makes this partnership beneficial?', required: true, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: 'contact_info', label: 'Primary Contact (Owner/Admin)', style: 1, placeholder: 'Discord username of main point of contact', required: true, max_length: 100 }] }
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
              { type: 1, components: [{ type: 4, custom_id: 'timezone', label: 'Your Timezone', style: 1, placeholder: 'e.g. EST, PST, GMT+1', required: true, max_length: 50 }] },
              { type: 1, components: [{ type: 4, custom_id: 'member_duration', label: 'How long have you been a member?', style: 1, placeholder: 'e.g. 6 months, 1 year', required: true, max_length: 100 }] },
              { type: 1, components: [{ type: 4, custom_id: 'why_mod', label: 'Why join the Mod Team?', style: 2, placeholder: 'What motivates you?', required: true, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: 'streamers_meaning', label: 'Streamers supporting Streamers meaning?', style: 2, placeholder: 'In your own words...', required: true, max_length: 500 }] }
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
              { type: 1, components: [{ type: 4, custom_id: 'discord_experience', label: 'Discord Moderation Experience', style: 2, placeholder: 'Describe your experience', required: true, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: 'availability', label: 'Availability', style: 2, placeholder: 'When are you typically available?', required: true, max_length: 200 }] },
              { type: 1, components: [{ type: 4, custom_id: 'why_admin', label: 'Why do you want to be an admin?', style: 2, placeholder: 'What motivates you?', required: true, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: 'conflict_resolution', label: 'How would you handle conflicts?', style: 2, placeholder: 'Describe your approach', required: true, max_length: 500 }] }
            ]
          }
        });
      }
    }

    if (body.type === 5 && customId) {
      const userId = body.member?.user?.id || body.user?.id;
      if (!userId) {
        return ephemeral('🚫 Unable to identify user.');
      }

      if (customId.startsWith('link_twitch_modal_')) {
        const serverId = customId.replace('link_twitch_modal_', '');
        const values = extractValues(body.data?.components);
        const twitchUsername = values.twitch_username?.toLowerCase();
        
        // Fetch Discord user info
        const botToken = process.env.DISCORD_BOT_TOKEN;
        const guildMemberRes = await fetch(`https://discord.com/api/v10/guilds/${serverId}/members/${userId}`, {
          headers: { 'Authorization': `Bot ${botToken}` }
        });
        
        if (!guildMemberRes.ok) {
          return ephemeral('⚠️ Failed to fetch your Discord info.');
        }
        
        const memberData = await guildMemberRes.json();
        const roles = memberData.roles || [];
        
        // Fetch Twitch user info
        const { getUserByLogin } = await import('@/lib/twitch-api-service');
        const twitchUser = await getUserByLogin(twitchUsername);
        
        if (!twitchUser) {
          return ephemeral(`⚠️ Twitch user "${twitchUsername}" not found.`);
        }
        
        // Determine group based on roles
        const serverDoc = await db.collection('servers').doc(serverId).get();
        const roleMappings = serverDoc.data()?.roleMappings || {};
        
        let group = 'Community';
        for (const [roleId, groupName] of Object.entries(roleMappings)) {
          if (roles.includes(roleId)) {
            group = groupName as string;
            break;
          }
        }
        
        // Create/update user document
        await db.collection('servers').doc(serverId).collection('users').doc(userId).set({
          discordUserId: userId,
          username: memberData.user.username,
          avatarUrl: memberData.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${userId}/${memberData.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png',
          twitchLogin: twitchUsername,
          twitchId: twitchUser.id,
          group,
          roles,
          isOnline: false,
          linkedAt: new Date()
        }, { merge: true });
        
        // Log linking activity to dashboard recents
        await db.collection('servers').doc(serverId).collection('recentActivity').add({
          type: 'twitch_link',
          discordUserId: userId,
          discordUsername: memberData.user.username,
          twitchLogin: twitchUsername,
          twitchId: twitchUser.id,
          group,
          timestamp: new Date()
        });
        
        return ephemeral(`✅ Successfully linked Twitch account **${twitchUsername}**!\n\nYou'll get automatic shoutouts when you go live.\nGroup: **${group}**`);
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
        const embed = await generateScheduleEmbed(ownerId, serverId, {
          channelId: body.channel_id,
          messageId: body.message?.id
        });

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
          const embed = await generateScheduleEmbed(ownerId, serverId, {
            channelId: body.channel_id,
            messageId: body.message?.id
          });

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
        // Defer — submitCaptainLog regenerates calendar image
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await submitCaptainLog({ serverId, userId, selectedDate: values.log_date });
            const msg = (result as any).success ? `✅ ${(result as any).message}` : `⚠️ ${(result as any).error || 'Failed to save captain log.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] captain_log_modal error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      if (customId.startsWith('calendar_add_mission_modal_')) {
        const serverId = customId.replace('calendar_add_mission_modal_', '');
        const values = extractValues(body.data?.components);
        // Defer — submitMission regenerates calendar image
        fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }).then(async () => {
          try {
            const result = await submitMission({
              serverId, userId,
              missionName: values.mission_name,
              missionDescription: values.mission_description,
              missionDate: values.mission_date,
              missionTime: values.mission_time,
            });
            const msg = (result as any).success ? `✅ ${(result as any).message}` : `⚠️ ${(result as any).error || 'Failed to add mission.'}`;
            await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${body.token}/messages/@original`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: msg })
            });
          } catch (e) {
            console.error('[Interactions] add_mission_modal error:', e);
          }
        });
        return new Response(null, { status: 202 });
      }

      // ── Forwarded message modal submissions ──
      if (customId.startsWith('fwd_reply_submit_')) {
        const parts = customId.replace('fwd_reply_submit_', '').split('_');
        const originChannelId = parts[1];
        const originMessageId = parts[2];
        const replyText = body.data.components[0].components[0].value;
        const replierName = body.member?.user?.username || body.user?.username || 'Unknown';
        const botToken = process.env.DISCORD_BOT_TOKEN;

        await fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
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

        await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${body.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '✅ Reply sent to the original channel!' })
        });

        return new Response(null, { status: 200 });
      }

      if (customId.startsWith('fwd_react_submit_')) {
        const parts = customId.replace('fwd_react_submit_', '').split('_');
        const originChannelId = parts[1];
        const originMessageId = parts[2];
        const emoji = body.data.components[0].components[0].value.trim();
        const botToken = process.env.DISCORD_BOT_TOKEN;

        await fetch(`https://discord.com/api/v10/interactions/${body.id}/${body.token}/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 5, data: { flags: 64 } })
        });

        const encoded = encodeURIComponent(emoji);
        await fetch(
          `https://discord.com/api/v10/channels/${originChannelId}/messages/${originMessageId}/reactions/${encoded}/@me`,
          { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } },
        );

        await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${body.token}/messages/@original`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `✅ Reacted with ${emoji}!` })
        });

        return new Response(null, { status: 200 });
      }

      if (customId === 'partner_application_submit') {
        const serverId = body.guild_id;
        const username = body.member?.user?.username || body.user?.username;
        const components = body.data.components;
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'partner', userId, username,
          communityName: components[0].components[0].value,
          communityFocus: components[1].components[0].value,
          whyPartner: components[2].components[0].value,
          contactInfo: components[3].components[0].value,
          status: 'pending', submittedAt: new Date()
        });
        return ephemeral('✅ Your partnership application has been submitted! We\'ll review it and get back to you soon.');
      }

      if (customId === 'mod_application_submit') {
        const serverId = body.guild_id;
        const username = body.member?.user?.username || body.user?.username;
        const components = body.data.components;
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'mod', userId, username,
          timezone: components[0].components[0].value,
          memberDuration: components[1].components[0].value,
          whyMod: components[2].components[0].value,
          streamersMeaning: components[3].components[0].value,
          status: 'pending', submittedAt: new Date()
        });
        return ephemeral('✅ Your mod team application has been submitted! We\'ll review it and get back to you soon.');
      }

      if (customId === 'admin_application_submit') {
        const serverId = body.guild_id;
        const username = body.member?.user?.username || body.user?.username;
        const components = body.data.components;
        await db.collection('servers').doc(serverId).collection('applications').add({
          type: 'admin', userId, username,
          discordExperience: components[0].components[0].value,
          availability: components[1].components[0].value,
          whyAdmin: components[2].components[0].value,
          conflictResolution: components[3].components[0].value,
          status: 'pending', submittedAt: new Date()
        });
        return ephemeral('✅ Your admin application has been submitted! We\'ll review it and get back to you soon.');
      }
    }

    return NextResponse.json({ error: 'Unknown interaction' }, { status: 400 });
  } catch (error) {
    console.error('Discord interaction error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
