import { NextRequest, NextResponse } from 'next/server';
import { decideApplication } from '@/lib/application-admin-actions';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

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
    if (sessionReviewerId !== String(reviewerId)) {
      return NextResponse.json({ error: 'Only the server owner can approve or reject applications' }, { status: 403 });
    }
    const application = await decideApplication({ serverId, applicationId, reviewerId: sessionReviewerId, status });

    const response = NextResponse.json({
      success: true,
      application: {
        ...application,
      },
    });
    if (resolved.token !== sessionToken) response.cookies.set(DSH_SPMT_COOKIE, resolved.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    console.error('Error updating application decision:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
