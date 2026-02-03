'use server';

import { NextRequest, NextResponse } from 'next/server';
import { generateAllShoutouts, postAllShoutoutsToDiscord } from '@/lib/automated-shoutout-system';

export async function POST(req: NextRequest) {
  try {
    const { serverId } = await req.json();

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required.' }, { status: 400 });
    }
    
    // This function will handle everything: polling, generating, and posting.
    await generateAllShoutouts(serverId);
    await postAllShoutoutsToDiscord(serverId);

    return NextResponse.json({ message: 'Shoutout cycle complete. All messages dispatched.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[Dispatch Shoutouts Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
