import { NextRequest, NextResponse } from 'next/server';
import { CommunityTrackingService } from '@/lib/community-tracking-service';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type') || 'user';
    
    const trackingService = CommunityTrackingService.getInstance();
    
    if (type === 'user' && userId) {
      const metrics = await trackingService.getUserMetrics(userId);
      return NextResponse.json(metrics);
    } else if (type === 'contributors') {
      const limit = parseInt(searchParams.get('limit') || '10');
      const contributors = await trackingService.getTopContributors(limit);
      return NextResponse.json(contributors);
    }
    
    return NextResponse.json({ error: 'Invalid request. Specify userId for user metrics or type=contributors' }, { status: 400 });

  } catch (error) {
    console.error('Error fetching community metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}