import { NextRequest, NextResponse } from 'next/server';
import { batchLinkTwitchAccounts } from '@/lib/twitch-linking-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    const result = await batchLinkTwitchAccounts(serverId);
    
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/batch-link]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
