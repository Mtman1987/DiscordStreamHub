import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET  /api/settings/forwarding-forums?serverId=xxx
 * POST /api/settings/forwarding-forums  { serverId, forumChannelId, mappings: { sourceChannelId: threadId } }
 *
 * Stores at: servers/{serverId}/config/forwardingForums  { forumChannelId, mappings: { ... } }
 */

export async function GET(request: NextRequest) {
  const serverId = request.nextUrl.searchParams.get('serverId');
  if (!serverId) return NextResponse.json({ error: 'serverId required' }, { status: 400 });

  try {
    const doc = await db.collection('servers').doc(serverId).collection('config').doc('forwardingForums').get();
    return NextResponse.json(doc.exists ? doc.data() : { mappings: {} });
  } catch (error) {
    console.error('[ForwardingForums] GET error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { serverId, forumChannelId, mappings, labels } = await request.json();
    if (!serverId || !mappings) {
      return NextResponse.json({ error: 'serverId and mappings required' }, { status: 400 });
    }

    await db.collection('servers').doc(serverId).collection('config').doc('forwardingForums').set(
      {
        forumChannelId: forumChannelId || undefined,
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
