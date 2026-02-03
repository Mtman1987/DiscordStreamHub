import { NextRequest, NextResponse } from 'next/server';
import { raidTrainService } from '@/lib/raid-train-service';

export async function POST(request: NextRequest) {
  try {
    const { 
      serverId, 
      date, 
      hour, 
      userId, 
      username, 
      displayName, 
      avatarUrl, 
      twitchUsername 
    } = await request.json();
    
    if (!serverId || !date || hour === undefined || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const success = await raidTrainService.signupForSlot(serverId, date, hour, {
      userId,
      username,
      displayName,
      avatarUrl,
      twitchUsername,
    });

    if (!success) {
      return NextResponse.json({ 
        error: 'Slot unavailable or cannot signup for today' 
      }, { status: 400 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Raid train signup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { serverId, date, hour, userId } = await request.json();
    
    if (!serverId || !date || hour === undefined || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const success = await raidTrainService.cancelSlot(serverId, date, hour, userId);

    if (!success) {
      return NextResponse.json({ 
        error: 'Cannot cancel slot - not found or not yours' 
      }, { status: 400 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Raid train cancel error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}