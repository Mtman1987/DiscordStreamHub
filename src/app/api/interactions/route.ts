import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { shiftCalendarMonth } from '@/lib/calendar-discord-service';

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
