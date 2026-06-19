import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/data/server-init';
import { getHardcodedGuildId } from '@/lib/runtime-config';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('serverId') || getHardcodedGuildId();

    if (!serverId) {
      return NextResponse.json({ error: 'serverId is required' }, { status: 400 });
    }

    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
    
    const users = usersSnapshot.docs.map((doc: { id: string; data: () => any }) => ({
      id: doc.id,
      ...doc.data()
    }));

    const vipUsers = users.filter((u: any) => 
      (u.group === 'Crew' || u.group === 'Partners' || u.group === 'Vip') && u.twitchLogin
    );

    return NextResponse.json({
      serverId,
      totalUsers: users.length,
      vipUsers: vipUsers.length,
      vipUsersList: vipUsers.map((u: any) => ({
        discordUserId: u.id,
        group: u.group,
        twitchLogin: u.twitchLogin
      })),
      allGroups: [...new Set(users.map((u: any) => u.group).filter(Boolean))]
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
