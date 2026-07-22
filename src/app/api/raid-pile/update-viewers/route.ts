import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  try {
    if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, viewers, isLive } = await request.json();
    
    if (!userId || viewers === undefined) {
      return NextResponse.json({ error: 'userId and viewers are required' }, { status: 400 });
    }

    const raidPileService = RaidPileService.getInstance();
    await raidPileService.updateMemberViewers(userId, viewers, isLive !== false);
    
    return NextResponse.json({
      success: true,
      message: `Updated viewer count for user ${userId}: ${viewers} viewers`
    });

  } catch (error) {
    console.error('Error updating viewer count:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}