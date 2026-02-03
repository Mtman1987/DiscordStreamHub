import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    
    if (!serverId) {
      return NextResponse.json({ error: 'Server ID required' }, { status: 400 });
    }

    // Get online community members
    const usersRef = db.collection('servers').doc(serverId).collection('users');
    const snapshot = await usersRef
      .where('group', '==', 'Community')
      .where('isOnline', '==', true)
      .get();
    
    const onlineMembers = snapshot.docs
      .map(doc => doc.data().username)
      .filter(Boolean);
    
    return NextResponse.json({ 
      onlineMembers,
      count: onlineMembers.length 
    });
  } catch (error) {
    console.error('Error getting online members:', error);
    return NextResponse.json({ 
      error: 'Failed to get online members',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}