'use server';

import { NextRequest, NextResponse } from 'next/server';
import { batchLinkTwitchAccounts } from '@/lib/twitch-linking-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    console.log(`Starting batch Twitch linking for server ${serverId}...`);
    const result = await batchLinkTwitchAccounts(serverId);

    return NextResponse.json({
      success: true,
      linked: result.linked,
      notFound: result.notFound,
      errors: result.errors,
      message: `Linked ${result.linked} accounts. ${result.notFound.length} not found. ${result.errors.length} errors.`
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/link-twitch]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
