import { NextRequest, NextResponse } from 'next/server';
import { decideMtFixIt } from '@/lib/mtfixit-orchestrator';
import { getMtmanDiscordId } from '@/lib/owner-dm-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const expectedBotToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const suppliedBotToken = String(request.headers.get('x-discord-bot-token') || '').trim();
  if (!expectedBotToken || !suppliedBotToken || suppliedBotToken !== expectedBotToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { userId?: unknown; jobId?: unknown; action?: unknown } | null;
  const userId = String(body?.userId || '').trim();
  const jobId = String(body?.jobId || '').trim();
  const action = String(body?.action || '').trim().toLowerCase();
  if (!userId || userId !== getMtmanDiscordId()) return NextResponse.json({ error: 'Only mtman can approve MtFixIt deployment.' }, { status: 403 });
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(jobId)) return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
  if (action !== 'approve' && action !== 'deny') return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  try {
    const state = await decideMtFixIt(jobId, action);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    console.error(`[MtFixItDecision] ${action} failed job=${jobId}:`, error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Decision failed' }, { status: 409 });
  }
}
