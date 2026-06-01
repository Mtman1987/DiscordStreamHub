import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

type ForwardingRule = {
  serverId: string;
  ruleLabel: string;
  sourceServerId: string;
  destinationServerId: string;
  forumChannelId?: string;
  sharedThreadId?: string;
  forwardingMode?: string;
  restrictToWhitelist?: boolean;
  sourceChannelWhitelist?: string[];
};

export async function GET() {
  try {
    const serversSnap = await db.collection('servers').get();
    const rules: ForwardingRule[] = [];

    for (const serverDoc of serversSnap.docs || []) {
      const serverId = serverDoc.id;
      const configDoc = await db.collection('servers').doc(serverId).collection('config').doc('forwardingForums').get();
      if (!configDoc.exists) continue;

      const data = configDoc.data() || {};
      rules.push({
        serverId,
        ruleLabel: String(data.ruleLabel || `${data.sourceServerId || serverId} → ${data.destinationServerId || ''}`).trim(),
        sourceServerId: String(data.sourceServerId || serverId),
        destinationServerId: String(data.destinationServerId || ''),
        forumChannelId: data.forumChannelId || undefined,
        sharedThreadId: data.sharedThreadId || undefined,
        forwardingMode: data.forwardingMode || 'per-source-thread',
        restrictToWhitelist: Boolean(data.restrictToWhitelist),
        sourceChannelWhitelist: Array.isArray(data.sourceChannelWhitelist) ? data.sourceChannelWhitelist.map((id: string) => String(id)) : [],
      });
    }

    return NextResponse.json({ rules });
  } catch (error) {
    console.error('[ForwardingForumsList] GET error:', error);
    return NextResponse.json({ error: 'Failed to list rules' }, { status: 500 });
  }
}
