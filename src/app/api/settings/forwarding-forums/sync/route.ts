import { NextRequest, NextResponse } from 'next/server';
import { loadForumRule, syncForumChannels } from '@/lib/discord-forum-mirror';
import { requireGuildManagement } from '@/lib/discord-guild-access';
import { sameOrigin, ServerConnectionError } from '@/lib/discord-server-connections';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { sourceServerId } = await request.json();
    const rule = loadForumRule(String(sourceServerId || ''));
    if (!rule) return NextResponse.json({ error: 'Save a forwarding rule first.' }, { status: 404 });
    await requireGuildManagement(request, rule.sourceServerId);
    await requireGuildManagement(request, rule.destinationServerId);
    const sync = await syncForumChannels(rule);
    return NextResponse.json({ success: !sync.errors.length, sync }, { status: sync.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Synchronization failed' },
      { status: error instanceof ServerConnectionError ? error.status : 500 });
  }
}
