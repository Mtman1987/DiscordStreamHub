import { NextRequest, NextResponse } from 'next/server';
import { RaidPileService } from '@/lib/raid-pile-service';
import { getRaidPilePointsReward } from '@/lib/runtime-config';
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
    const result = await raidPileService.getNextRaidTarget(userId);
    
    if (!result.target) {
      return NextResponse.json({
        type: 'INTERACTION_CALLBACK_TYPE',
        data: {
          content: result.message,
          flags: 64 // Ephemeral
        }
      });
    }

    // Award points for raiding
    await raidPileService.awardRaidPoints(userId, username, displayName || username);
    
    return NextResponse.json({
      type: 'INTERACTION_CALLBACK_TYPE',
      data: {
        content: `${result.message}\n\n🎉 You earned ${getRaidPilePointsReward()} points for participating in the pile!`,
        flags: 64 // Ephemeral
      }
    });

  } catch (error) {
    console.error('Error getting next raid target:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
