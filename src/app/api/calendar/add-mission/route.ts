import { NextRequest, NextResponse } from 'next/server';
import { submitMission } from '@/lib/calendar-admin-actions';

export async function POST(request: NextRequest) {
  try {
    const { serverId, userId, missionName, missionDate, missionTime, missionTimeZone, missionDescription } = await request.json();
    
    const result = await submitMission({
      serverId,
      userId,
      missionName,
      missionDescription,
      missionDate,
      missionTime,
      missionTimeZone,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to add mission' }, { status: result.statusCode || 400 });
    }

    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Add mission error:', error);
    return NextResponse.json({ error: 'Failed to add mission' }, { status: 500 });
  }
}
