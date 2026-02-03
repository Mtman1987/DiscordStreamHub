import { NextRequest, NextResponse } from 'next/server';
import { CommunityTrackingService } from '@/lib/community-tracking-service';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      userId, 
      username, 
      displayName, 
      platform, 
      activityType, 
      metadata 
    } = await request.json();
    
    if (!userId || !username || !platform || !activityType) {
      return NextResponse.json({ error: 'userId, username, platform, and activityType are required' }, { status: 400 });
    }

    const trackingService = CommunityTrackingService.getInstance();
    
    if (platform === 'twitch') {
      await trackingService.trackTwitchActivity(userId, username, displayName || username, activityType, metadata);
    } else if (platform === 'discord') {
      await trackingService.trackDiscordActivity(userId, username, displayName || username, activityType, metadata);
    } else {
      return NextResponse.json({ error: 'Invalid platform. Must be "twitch" or "discord"' }, { status: 400 });
    }
    
    return NextResponse.json({
      success: true,
      message: `Tracked ${activityType} activity for ${displayName || username} on ${platform}`
    });

  } catch (error) {
    console.error('Error tracking community activity:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}