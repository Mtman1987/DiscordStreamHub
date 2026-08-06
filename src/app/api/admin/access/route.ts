import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ error: 'SPMT session required' }, { status: 401 });

  try {
    const resolved = await resolveSpmtSession(token);
    if (!resolved.session.isAdmin) {
      return NextResponse.json({ error: 'SPMT administrator access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const requestedUserId = String(body.userId || body.discordUserId || '').trim();
    const sessionUserId = String(resolved.session.discordUserId || '').trim();
    if (requestedUserId && sessionUserId && requestedUserId !== sessionUserId) {
      return NextResponse.json({ error: 'Cannot query administrator access for another user' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      serverId: String(body.serverId || body.guildId || resolved.session.discordServerId || ''),
      userId: sessionUserId,
      isAdmin: true,
      isMod: true,
      isOwner: resolved.session.role === 'owner',
      matchedBy: 'spmt',
      spmtUserId: resolved.session.spmtUserId,
    });
  } catch (error) {
    console.warn('[admin/access] SPMT validation failed:', error instanceof Error ? error.message : String(error));
    const response = NextResponse.json({ error: 'SPMT session is invalid or expired' }, { status: 401 });
    response.cookies.set(DSH_SPMT_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  }
}
