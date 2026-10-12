import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sqliteService } from '@/lib/sqlite-service';
import { loadForumRule, rulePath, syncForumChannels, forumDiscordRequest } from '@/lib/discord-forum-mirror';
import { requireGuildManagement } from '@/lib/discord-guild-access';
import { sameOrigin, ServerConnectionError } from '@/lib/discord-server-connections';

/**
 * GET  /api/settings/forwarding-forums?sourceServerId=xxx
 * POST /api/settings/forwarding-forums  {
 *   ruleLabel,
 *   sourceServerId,
 *   destinationServerId,
 *   forumChannelId,
 *   forwardingMode,
 *   sharedThreadId,
 *   restrictToWhitelist,
 *   sourceChannelWhitelist,
 *   mappings: { sourceChannelId: threadId }
 * }
 *
 * Stores at: servers/{sourceServerId}/config/forwardingForums
 *   {
 *     ruleLabel,
 *     sourceServerId,
 *     destinationServerId,
 *     forumChannelId,
 *     forwardingMode,
 *     sharedThreadId,
 *     restrictToWhitelist,
 *     sourceChannelWhitelist,
 *     mappings: { ... }
 *   }
 */

export async function GET(request: NextRequest) {
  const sourceServerId = request.nextUrl.searchParams.get('sourceServerId') || request.nextUrl.searchParams.get('serverId');
  if (!sourceServerId) return NextResponse.json({ error: 'sourceServerId required' }, { status: 400 });

  try {
    await requireGuildManagement(request, sourceServerId);
    const doc = await db.collection('servers').doc(sourceServerId).collection('config').doc('forwardingForums').get();
    return NextResponse.json(doc.exists ? doc.data() : {
      ruleLabel: '',
      sourceServerId,
      destinationServerId: '',
      mappings: {},
      forwardingMode: 'per-source-thread',
      restrictToWhitelist: false,
      sourceChannelWhitelist: [],
    });
  } catch (error) {
    console.error('[ForwardingForums] GET error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load' }, { status: error instanceof ServerConnectionError ? error.status : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const body = await request.json();
    const ruleLabel = typeof body.ruleLabel === 'string' ? body.ruleLabel.trim() : '';
    const sourceServerId = String(body.sourceServerId || body.serverId || '').trim();
    const destinationServerId = String(body.destinationServerId || '').trim();
    const {
      forumChannelId,
      forwardingMode,
      sharedThreadId,
      restrictToWhitelist,
      sourceChannelWhitelist,
      mappings,
      labels,
    } = body;
    if (!sourceServerId || !destinationServerId || !mappings) {
      return NextResponse.json({ error: 'sourceServerId, destinationServerId and mappings required' }, { status: 400 });
    }

    await requireGuildManagement(request, sourceServerId);
    await requireGuildManagement(request, destinationServerId);
    const mode = forwardingMode === 'single-thread' ? 'single-thread' : 'per-source-thread';
    const targetId = String(mode === 'single-thread' ? sharedThreadId || '' : forumChannelId || '').trim();
    const target = await forumDiscordRequest('/channels/' + targetId);
    if (target.guild_id !== destinationServerId || !(mode === 'single-thread' ? [10, 11, 12] : [15, 16]).includes(Number(target.type))) {
      return NextResponse.json({ error: 'Choose a valid destination forum/thread in the selected destination server' }, { status: 400 });
    }
    const existing = loadForumRule(sourceServerId);
    if (existing && (existing.destinationServerId !== destinationServerId || String(existing.forumChannelId || '') !== (mode === 'per-source-thread' ? targetId : ''))) {
      // Keep historical channel mappings; a changed destination starts a separate identity.
      sqliteService.setDoc('forwardingRuleHistory/' + sourceServerId + '_' + Date.now(), existing);
      sqliteService.setDoc(rulePath(sourceServerId), { ...existing, mappings: {}, labels: {} });
    }
    sqliteService.mergeDocMaps(rulePath(sourceServerId), {
      mappings: mappings || {}, labels: labels || {},
    }, {
      ruleLabel: ruleLabel || sourceServerId + ' → ' + destinationServerId,
      sourceServerId, destinationServerId, forwardingMode: mode,
      forumChannelId: mode === 'per-source-thread' ? targetId : '',
      sharedThreadId: mode === 'single-thread' ? targetId : '',
      restrictToWhitelist: Boolean(restrictToWhitelist),
      sourceChannelWhitelist: Array.isArray(sourceChannelWhitelist) ? sourceChannelWhitelist.map(String).map((id: string) => id.trim()).filter(Boolean) : [],
      updatedAt: new Date().toISOString(),
    });
    // Include silent channels immediately. Retry Sync Channels after partial permission failures.
    const sync = await syncForumChannels(loadForumRule(sourceServerId)!);
    return NextResponse.json({ success: sync.errors.length === 0, saved: true, sync }, { status: sync.errors.length ? 207 : 200 });

  } catch (error) {
    console.error('[ForwardingForums] POST error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save' }, { status: error instanceof ServerConnectionError ? error.status : 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const body = await request.json().catch(() => ({}));
    const sourceServerId = String(body.sourceServerId || body.serverId || '').trim();
    if (!sourceServerId) {
      return NextResponse.json({ error: 'sourceServerId required' }, { status: 400 });
    }

    await requireGuildManagement(request, sourceServerId);
    await db.collection('servers').doc(sourceServerId).collection('config').doc('forwardingForums').delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ForwardingForums] DELETE error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete' }, { status: error instanceof ServerConnectionError ? error.status : 500 });
  }
}
