import { NextRequest, NextResponse } from 'next/server';
import { resolveSpmtPointsWallet } from '@/lib/spmt-wallet';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = body.userId || body.discordUserId;
    const username = body.username || body.discordUsername || userId;
    const serverId = body.serverId || body.guildId || body.discordServerId;

    if (!userId || !serverId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const wallet = await resolveSpmtPointsWallet({
      serverId,
      userId,
      source: 'discord',
      metadata: { username, displayName: body.displayName || username },
    });

    if (!wallet) {
      return NextResponse.json({ error: 'Canonical SPMT XP unavailable' }, { status: 503 });
    }

    return NextResponse.json({
      content: `🏆 **${username}**, you are rank #${wallet.rank} with ${wallet.lifetimePoints.toLocaleString()} XP! 🚀`,
    });
  } catch (error) {
    console.error('Check rank error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
