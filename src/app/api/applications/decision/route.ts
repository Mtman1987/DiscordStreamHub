import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const OWNER_ROLE_ID = '1283213615939194955';

function isOwner(serverId: string, reviewerId: string) {
  if (!serverId || !reviewerId) return false;
  if (reviewerId === getHardcodedAdminDiscordId()) return true;

  const server = db.get('servers', serverId) || {};
  if (String(server.ownerId || '').trim() === reviewerId) return true;

  const user = db.get(`servers/${serverId}/users`, reviewerId) || {};
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  return roles.includes(OWNER_ROLE_ID);
}

export async function POST(req: NextRequest) {
  try {
    const { serverId, applicationId, reviewerId, status } = await req.json();

    if (!serverId || !applicationId || !reviewerId || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (status !== 'approved' && status !== 'rejected') {
      return NextResponse.json({ error: 'Status must be approved or rejected' }, { status: 400 });
    }

    const sessionToken = req.cookies.get(DSH_SPMT_COOKIE)?.value || '';
    if (!sessionToken) return NextResponse.json({ error: 'SPMT owner authorization required' }, { status: 401 });
    let resolved;
    try { resolved = await resolveSpmtSession(sessionToken); }
    catch { return NextResponse.json({ error: 'SPMT owner authorization expired' }, { status: 401 }); }
    const sessionReviewerId = String(resolved.session.discordUserId || '');
    if (sessionReviewerId !== String(reviewerId) || !isOwner(String(serverId), sessionReviewerId)) {
      return NextResponse.json({ error: 'Only the server owner can approve or reject applications' }, { status: 403 });
    }

    const appRef = db.collection('servers').doc(serverId).collection('applications').doc(applicationId);
    const appDoc = await appRef.get();

    if (!appDoc.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const application = appDoc.data() || {};
    const nextHistory = [
      ...(Array.isArray(application.stateHistory) ? application.stateHistory : []),
      { status, at: now, actorId: sessionReviewerId },
      { status: 'archived', decisionStatus: status, at: now, actorId: sessionReviewerId, reason: 'final-decision' },
    ];

    await appRef.update({
      status,
      reviewedAt: now,
      reviewedBy: sessionReviewerId,
      archivedAt: now,
      archivedBy: sessionReviewerId,
      archiveReason: 'final-decision',
      stateHistory: nextHistory,
    });

    const response = NextResponse.json({
      success: true,
      application: {
        id: applicationId,
        ...application,
        status,
        reviewedAt: now,
        reviewedBy: sessionReviewerId,
        archivedAt: now,
        archivedBy: sessionReviewerId,
        archiveReason: 'final-decision',
        stateHistory: nextHistory,
      },
    });
    if (resolved.token !== sessionToken) response.cookies.set(DSH_SPMT_COOKIE, resolved.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    console.error('Error updating application decision:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
