import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

export async function GET(request: NextRequest) {
  const serverId = request.nextUrl.searchParams.get('serverId');
  
  if (!serverId) {
    return NextResponse.json({ error: 'serverId required' }, { status: 400 });
  }

  const channelsDoc = await db.collection('servers').doc(serverId).collection('config').doc('channels').get();
  
  if (!channelsDoc.exists) {
    return NextResponse.json([]);
  }

  const channelsList = channelsDoc.data()?.list || [];
  return NextResponse.json(channelsList.filter((c: any) => c.type === 0 || c.type === 11));
}
