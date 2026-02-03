'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getUnmatchedUsers } from '@/lib/twitch-linking-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('serverId');

    if (!serverId) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    const unmatchedUsers = await getUnmatchedUsers(serverId);
    return NextResponse.json(unmatchedUsers);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API /discord/unmatched-users]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
