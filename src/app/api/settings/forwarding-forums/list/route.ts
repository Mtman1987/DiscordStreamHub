import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serverAccount, discoveredServers, ServerConnectionError } from '@/lib/discord-server-connections';

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

export async function GET(request: NextRequest) {
  try {
    const session = await serverAccount(request);
    const allowed = new Set((await discoveredServers(session.spmtUserId!, session.discordUserId)).map((server: any) => server.id));
    const serversSnap = await db.collection('servers').get();
    const rules: ForwardingRule[] = [];

    for (const serverDoc of serversSnap.docs || []) {
      const serverId = serverDoc.id;
      if (!allowed.has(serverId)) continue;
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
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to list rules' }, { status: error instanceof ServerConnectionError ? error.status : 500 });
  }
}
