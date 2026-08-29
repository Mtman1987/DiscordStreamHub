import { NextRequest, NextResponse } from 'next/server';
import { postApplicationEmbed } from '@/lib/bot-action-service';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const OWNER_ROLE_ID = '1283213615939194955';

function isOwner(serverId: string, userId: string) {
  if (!serverId || !userId) return false;
  if (userId === getHardcodedAdminDiscordId()) return true;

  const server = db.get('servers', serverId) || {};
  if (String(server.ownerId || '').trim() === userId) return true;

  const user = db.get(`servers/${serverId}/users`, userId) || {};
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  return roles.includes(OWNER_ROLE_ID);
}

export async function POST(req: NextRequest) {
  try {
    const { serverId, channelId } = await req.json();

    if (!serverId || !channelId) {
      return NextResponse.json({ error: 'Missing serverId or channelId' }, { status: 400 });
    }

    const sessionToken = req.cookies.get(DSH_SPMT_COOKIE)?.value || '';
    if (!sessionToken) {
      return NextResponse.json({ error: 'SPMT owner authorization required' }, { status: 401 });
    }

    let resolved;
    try {
      resolved = await resolveSpmtSession(sessionToken);
    } catch {
      return NextResponse.json({ error: 'SPMT owner authorization expired' }, { status: 401 });
    }

    const userId = String(resolved.session.discordUserId || '');
    if (!isOwner(String(serverId), userId)) {
      return NextResponse.json({ error: 'Only the server owner can deploy application embeds' }, { status: 403 });
    }

    const response = NextResponse.json(await postApplicationEmbed(serverId, channelId));
    if (resolved.token !== sessionToken) {
      response.cookies.set(DSH_SPMT_COOKIE, resolved.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return response;
  } catch (error) {
    console.error('Error posting applications embed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
