import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { matchesGroup } from '@/lib/group-utils';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

function hasServiceAccess(request: NextRequest): boolean {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
}

export async function GET(request: NextRequest) {
  if (!hasServiceAccess(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serverId = String(request.nextUrl.searchParams.get('serverId') || '').trim();
  const group = String(request.nextUrl.searchParams.get('group') || '').trim().toLowerCase();
  if (!serverId) {
    return NextResponse.json({ error: 'serverId required' }, { status: 400 });
  }

  try {
    const snapshot = await db.collection('servers').doc(serverId).collection('users').get();
    const members = snapshot.docs
      .map((doc: { id: string; data: () => any }) => ({ id: doc.id, ...doc.data() }))
      .filter((member: any) => !group || matchesGroup(member.group, group))
      .map((member: any) => ({
        id: String(member.id || ''),
        discordUserId: String(member.discordUserId || member.id || ''),
        username: String(member.username || ''),
        displayName: String(member.displayName || member.globalName || member.username || ''),
        twitchLogin: String(member.twitchLogin || member.twitchUsername || '').trim().toLowerCase(),
        avatarUrl: String(member.avatarUrl || ''),
        group: String(member.group || ''),
      }));
    return NextResponse.json({ members });
  } catch (error) {
    console.error('[Checkin Members] Lookup failed:', error);
    return NextResponse.json({ error: 'Failed to fetch check-in members' }, { status: 500 });
  }
}
