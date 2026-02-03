import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';
import { submitCaptainLog, submitMission } from '@/lib/calendar-admin-actions';
import { shiftCalendarMonth } from '@/lib/calendar-discord-service';

function extractValues(components: any[] = []) {
  const values: Record<string, string> = {};
  components.forEach(row => {
    row.components?.forEach((component: any) => {
      values[component.custom_id] = component.value;
    });
  });
  return values;
}

function ephemeral(content: string) {
  return NextResponse.json({
    type: 4,
    data: { content, flags: 64 },
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
