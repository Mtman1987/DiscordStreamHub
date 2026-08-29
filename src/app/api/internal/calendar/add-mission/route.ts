import { NextRequest, NextResponse } from 'next/server';
import { submitMission } from '@/lib/calendar-admin-actions';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const result = await submitMission({
      serverId: String(body.serverId || ''),
      userId: String(body.userId || ''),
      missionName: String(body.missionName || ''),
      missionDescription: String(body.missionDescription || ''),
      missionDate: String(body.missionDate || ''),
      missionTime: String(body.missionTime || ''),
      missionTimeZone: String(body.missionTimeZone || ''),
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[InternalCalendar] Add mission failed:', error);
    return NextResponse.json({ error: 'Failed to add calendar event' }, { status: 500 });
  }
}
