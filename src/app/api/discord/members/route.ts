import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const serverId =
      request.nextUrl.searchParams.get('serverId') ||
      request.nextUrl.searchParams.get('guildId') ||
      request.nextUrl.searchParams.get('discordServerId');
    
    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    const snapshot = await db.collection('servers').doc(serverId).collection('users').get();
    
    const members = snapshot.docs.map((doc: { id: string; data: () => any }) => ({
      id: doc.id,
      ...doc.data()
    }));

    return NextResponse.json(members);
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}
