import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  try {
    if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, username, displayName } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const raidPileService = RaidPileService.getInstance();
    const success = await raidPileService.leavePile(userId);
    
    if (!success) {
      return NextResponse.json({ error: 'User not found in any pile' }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      message: `${displayName || username} left the raid pile. Safe travels, Captain!`
    });

  } catch (error) {
    console.error('Error leaving raid pile:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}