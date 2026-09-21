import { NextRequest, NextResponse } from 'next/server';
import { resolveSpmtPointsWallet } from '@/lib/spmt-wallet';
import { verifyKey } from 'discord-interactions';
import { getDiscordPublicKey } from '@/lib/runtime-config';

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const rawBody = await request.text();

    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 });
    }

    const isValid = verifyKey(rawBody, signature, timestamp, getDiscordPublicKey());
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    if (body.type === 1) {
      return NextResponse.json({ type: 1 });
    }

    if (body.type === 3 && body.data.custom_id === 'check_rank') {
      const userId = body.member?.user?.id || body.user?.id;
      const guildId = body.guild_id;
      const username = body.member?.user?.username || body.user?.username || userId;

      if (!userId || !guildId) {
        return NextResponse.json({
          type: 4,
          data: { content: 'Unable to identify user or server.', flags: 64 },
        });
      }

      const wallet = await resolveSpmtPointsWallet({
        serverId: guildId,
        userId,
        source: 'discord',
        metadata: { username, displayName: username },
      });

      return NextResponse.json({
        type: 4,
        data: {
          content: wallet
            ? `🏆 **Your Rank:** #${wallet.rank}\n📊 **Lifetime XP:** ${wallet.lifetimePoints.toLocaleString()}`
            : 'Canonical SPMT XP is temporarily unavailable.',
          flags: 64,
        },
      });
    }

    return NextResponse.json({ error: 'Unknown interaction' }, { status: 400 });
  } catch (error) {
    console.error('Interaction error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
