import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';

export async function POST(request: NextRequest) {
  try {
    const { 
      messageId, 
      channelId, 
      channelName, 
      userId, 
      username, 
      displayName, 
      avatarUrl, 
      content, 
      timestamp,
      serverId 
    } = await request.json();

    if (!messageId || !channelId || !userId || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Store message in Firestore
    const messageData = {
      messageId,
      channelId,
      channelName: channelName || 'Unknown Channel',
      userId,
      username: username || 'Unknown User',
      displayName: displayName || username || 'Unknown User',
      avatarUrl: avatarUrl || '',
      content,
      timestamp: new Date(timestamp || Date.now()),
      serverId: serverId || process.env.HARDCODED_GUILD_ID,
    };

    await db
      .collection('servers')
      .doc(messageData.serverId)
      .collection('messages')
      .doc(messageId)
      .set(messageData);

    // Update user activity
    if (serverId) {
      const userRef = db
        .collection('servers')
        .doc(serverId)
        .collection('users')
        .doc(userId);
      
      await userRef.update({
        lastMessageAt: new Date(),
        lastChannelId: channelId,
        messageCount: db.FieldValue.increment(1),
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Discord chat logging error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}