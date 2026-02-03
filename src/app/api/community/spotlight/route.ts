import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSpotlight } from '@/lib/community-spotlight-service';

async function fetchSpotlight(serverId?: string | null) {
  if (!serverId) {
    return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
  }

  try {
    const spotlight = await getCurrentSpotlight(serverId);
    return NextResponse.json({ spotlight });
  } catch (error) {
    console.error('[CommunitySpotlightAPI] Failed to load spotlight:', error);
    return NextResponse.json({ error: 'Failed to load spotlight' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const serverId = request.nextUrl.searchParams.get('serverId');
  return fetchSpotlight(serverId);
}

export async function POST(request: NextRequest) {
  const { serverId } = await request.json();
  return fetchSpotlight(serverId);
}
