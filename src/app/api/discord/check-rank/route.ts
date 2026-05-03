import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = body.userId || body.discordUserId;
    const username = body.username || body.discordUsername;
    const serverId = body.serverId || body.guildId || body.discordServerId;
    
    if (!userId || !serverId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }
    
    // Get user's rank and points
    const leaderboardRef = db.collection('servers').doc(serverId).collection('leaderboard');
    const userDoc = await leaderboardRef.doc(userId).get();
    
    if (!userDoc.exists) {
      return NextResponse.json({
        content: `🚀 **${username}**, you haven't earned any points yet! Start participating in the community to climb the leaderboard! 🌟`
      });
    }
    
    const userData = userDoc.data();
    const userPoints = userData?.points || 0;
    
    // Get user's rank by counting users with more points
    const higherRankedSnapshot = await leaderboardRef
      .where('points', '>', userPoints)
      .get();
    
    const rank = higherRankedSnapshot.size + 1;
    
    return NextResponse.json({
      content: `🏆 **${username}**, you are rank #${rank} with ${userPoints.toLocaleString()} points! 🚀\n\n${rank <= 10 ? '⭐ You\'re in the top 10! Great job!' : '💪 Keep earning points to climb higher!'}`
    });
    
  } catch (error) {
    console.error('Check rank error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
