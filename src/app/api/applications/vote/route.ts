import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

export async function POST(req: NextRequest) {
  try {
    const { serverId, applicationId, adminId, odminId, adminName, vote } = await req.json();
    const claimedVoterId = adminId || odminId;

    if (!serverId || !applicationId || !claimedVoterId || !vote) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (vote !== 'approve' && vote !== 'reject') {
      return NextResponse.json({ error: 'Vote must be "approve" or "reject"' }, { status: 400 });
    }

    const sessionToken = req.cookies.get(DSH_SPMT_COOKIE)?.value || '';
    if (!sessionToken) return NextResponse.json({ error: 'SPMT crew authorization required' }, { status: 401 });
    let resolved;
    try { resolved = await resolveSpmtSession(sessionToken); }
    catch { return NextResponse.json({ error: 'SPMT crew authorization expired' }, { status: 401 }); }
    const voterId = String(resolved.session.discordUserId || '');
    if (!voterId || voterId !== String(claimedVoterId)) return NextResponse.json({ error: 'Voter identity does not match the SPMT session' }, { status: 403 });
    const storedUser = db.get(`servers/${serverId}/users`, voterId) || {};
    const server = db.get('servers', serverId) || {};
    const roles = Array.isArray(storedUser.roles) ? storedUser.roles.map(String) : [];
    const roleNames = Array.isArray(storedUser.roleNames) ? storedUser.roleNames.map((value: unknown) => String(value).toLowerCase()) : [];
    const adminRoles = Array.isArray(server.adminRoles) ? server.adminRoles.map((value: unknown) => String(value).toLowerCase()) : [];
    const allowed = storedUser.group === 'Crew' || storedUser.isAdmin === true || voterId === getHardcodedAdminDiscordId() || voterId === String(server.ownerId || '') || roles.some((role: string) => adminRoles.includes(role.toLowerCase())) || roleNames.some((role: string) => adminRoles.includes(role));
    if (!allowed) return NextResponse.json({ error: 'Only active Crew may vote on applications' }, { status: 403 });

    const voteRef = db.collection('servers').doc(serverId)
      .collection('applications').doc(applicationId)
      .collection('votes').doc(voterId);

    const existing = await voteRef.get();

    if (existing.exists && existing.data()?.vote === vote) {
      // Toggle off — remove vote
      await voteRef.delete();
      const response = NextResponse.json({ success: true, action: 'removed' });
      if (resolved.token !== sessionToken) response.cookies.set(DSH_SPMT_COOKIE, resolved.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }

    await voteRef.set({
      adminId: voterId,
      adminName: adminName || resolved.session.discordDisplayName || resolved.session.discordUsername || 'Crew',
      vote,
      votedAt: new Date(),
    });

    const response = NextResponse.json({ success: true, action: 'voted' });
    if (resolved.token !== sessionToken) response.cookies.set(DSH_SPMT_COOKIE, resolved.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    console.error('Error recording vote:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
