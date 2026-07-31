import { NextRequest, NextResponse } from 'next/server';
import {
  awardSpendableSpmtXp,
  getSpmtWallet,
  getSpmtXpLeaderboard,
  resolveDiscordSpmtUser,
  settleSpmtGamble,
  spendSpmtXp,
  transferSpmtXp,
} from '@/lib/spmt-wallet-client';

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const expected = String(process.env.DSH_SERVICE_SECRET || '').trim();
  const provided = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && provided && provided === expected);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const action = String(body?.action || 'balance').toLowerCase();
    if (action === 'leaderboard') {
      return NextResponse.json(await getSpmtXpLeaderboard(Number(body?.limit || 10)));
    }

    const actor = await resolveDiscordSpmtUser({
      discordId: String(body?.discordId || ''),
      discordUsername: String(body?.discordUsername || body?.username || 'discord-user'),
      displayName: String(body?.displayName || body?.discordUsername || body?.username || 'Discord User'),
      avatarUrl: String(body?.avatarUrl || ''),
    });

    if (action === 'balance') {
      return NextResponse.json({ user: actor, wallet: await getSpmtWallet(actor.id) });
    }
    if (action === 'spend') {
      const result = await spendSpmtXp({
        userId: actor.id,
        amount: Number(body?.amount),
        eventType: String(body?.eventType || 'discord-spend'),
        idempotencyKey: String(body?.idempotencyKey || ''),
        metadata: body?.metadata,
      });
      return NextResponse.json({ user: actor, wallet: result });
    }
    if (action === 'gamble-settle') {
      const result = await settleSpmtGamble({
        userId: actor.id,
        wager: Number(body?.wager),
        payout: Number(body?.payout),
        eventType: String(body?.eventType || 'discord-gamble'),
        idempotencyKey: String(body?.idempotencyKey || ''),
        metadata: body?.metadata,
      });
      return NextResponse.json({ user: actor, result });
    }
    if (action === 'award') {
      const result = await awardSpendableSpmtXp({
        userId: actor.id,
        amount: Number(body?.amount),
        eventType: String(body?.eventType || 'discord-award'),
        idempotencyKey: String(body?.idempotencyKey || ''),
        lifetimeEligible: body?.lifetimeEligible !== false,
        metadata: body?.metadata,
      });
      return NextResponse.json({ user: actor, result, wallet: await getSpmtWallet(actor.id) });
    }
    if (action === 'transfer') {
      const target = await resolveDiscordSpmtUser({
        discordId: String(body?.targetDiscordId || ''),
        discordUsername: String(body?.targetDiscordUsername || 'discord-user'),
        displayName: String(body?.targetDisplayName || body?.targetDiscordUsername || 'Discord User'),
        avatarUrl: String(body?.targetAvatarUrl || ''),
      });
      const result = await transferSpmtXp({
        fromUserId: actor.id,
        toUserId: target.id,
        amount: Number(body?.amount),
        eventType: String(body?.eventType || 'discord-transfer'),
        idempotencyKey: String(body?.idempotencyKey || ''),
        metadata: body?.metadata,
      });
      return NextResponse.json({ user: actor, target, result });
    }

    return NextResponse.json({ error: 'Unsupported wallet action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Wallet request failed' }, { status: 502 });
  }
}
