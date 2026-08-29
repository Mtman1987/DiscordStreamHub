import { NextRequest, NextResponse } from 'next/server';
import { notifyApplicationDecision } from '@/lib/application-admin-actions';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const serverId = String(body.serverId || '');
    const applicationId = String(body.applicationId || '');
    const status = String(body.status || '');
    if (!serverId || !applicationId || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Missing or invalid notification fields.' }, { status: 400 });
    }

    const sessionToken = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
    if (!sessionToken) return NextResponse.json({ error: 'SPMT owner authorization required.' }, { status: 401 });
    let resolved;
    try {
      resolved = await resolveSpmtSession(sessionToken);
    } catch {
      return NextResponse.json({ error: 'SPMT owner authorization expired.' }, { status: 401 });
    }

    const ownerId = String(resolved.session.discordUserId || '');
    const result = await notifyApplicationDecision({
      serverId,
      applicationId,
      ownerId,
      status: status as 'approved' | 'rejected',
      expectedUserId: body.userId ? String(body.userId) : undefined,
    });
    const response = NextResponse.json(result);
    if (resolved.token !== sessionToken) {
      response.cookies.set(DSH_SPMT_COOKIE, resolved.token, cookieOptions);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /owner/i.test(message) ? 403 : /not found/i.test(message) ? 404 : /does not match/i.test(message) ? 409 : /not configured/i.test(message) ? 503 : /discord|DM/i.test(message) ? 502 : 500;
    if (status >= 500) console.error('[applications/notify]', error);
    return NextResponse.json({ error: message }, { status });
  }
}
