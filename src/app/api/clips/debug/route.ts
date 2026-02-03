import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('serverId') || '1240832965865635881';

    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
    
    const users = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const vipUsers = users.filter(u => 
      (u.group === 'Crew' || u.group === 'Partners' || u.group === 'Vip') && u.twitchLogin
    );

    return NextResponse.json({
      serverId,
      totalUsers: users.length,
      vipUsers: vipUsers.length,
      vipUsersList: vipUsers.map(u => ({
        discordUserId: u.id,
        group: u.group,
        twitchLogin: u.twitchLogin
      })),
      allGroups: [...new Set(users.map(u => u.group).filter(Boolean))]
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
