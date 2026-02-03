import { NextRequest, NextResponse } from 'next/server';
import { initializeServerConfig } from '@/lib/setup-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serverId, crewChannelId, partnersChannelId, communityChannelId, raidPileChannelId } = body;

    const result = await initializeServerConfig(serverId, {
      crewChannelId,
      partnersChannelId,
      communityChannelId,
      raidPileChannelId
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
