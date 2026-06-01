import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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

    await db.collection('servers').doc(sourceServerId).collection('config').doc('forwardingForums').set(
      {
        ruleLabel: ruleLabel || `${sourceServerId} → ${destinationServerId}`,
        sourceServerId,
        destinationServerId,
        forumChannelId: forumChannelId || undefined,
        forwardingMode: forwardingMode === 'single-thread' ? 'single-thread' : 'per-source-thread',
        sharedThreadId: typeof sharedThreadId === 'string' ? sharedThreadId.trim() || undefined : undefined,
        restrictToWhitelist: Boolean(restrictToWhitelist),
        sourceChannelWhitelist: Array.isArray(sourceChannelWhitelist)
          ? sourceChannelWhitelist.map((id: string) => String(id).trim()).filter(Boolean)
          : [],
        mappings,
        labels: labels || {},
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ForwardingForums] POST error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sourceServerId = String(body.sourceServerId || body.serverId || '').trim();
    if (!sourceServerId) {
      return NextResponse.json({ error: 'sourceServerId required' }, { status: 400 });
    }

    await db.collection('servers').doc(sourceServerId).collection('config').doc('forwardingForums').delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ForwardingForums] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
