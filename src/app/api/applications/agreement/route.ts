import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { APPLICATION_DEFINITIONS, ApplicationType } from '@/lib/application-flow';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const ACCEPTANCE_SCHEDULE = {
  title: 'SPMT Electronic Acceptance Schedule',
  version: '2026-08-02',
  effectiveDate: '2026-08-02',
  url: 'https://spmt.live/docs/legal/ELECTRONIC_ACCEPTANCE_SCHEDULE.md',
  hash: 'e58e27dd986ccaf1ad767dd3c5591d2e05c02ece70f79089e80ce65ca3dd0ee6',
};

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requestFields(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return {
    serverId: params.get('serverId') || '',
    applicationId: params.get('applicationId') || '',
    token: params.get('token') || '',
    format: params.get('format') || '',
  };
}

async function loadOffer(serverId: string, applicationId: string, token: string) {
  if (!serverId || !applicationId || !token) return null;
  const ref = db.collection('servers').doc(serverId).collection('applications').doc(applicationId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const application = snapshot.data() || {};
  const expected = String(application.agreementOffer?.tokenHash || '');
  if (!expected || !safeEqual(expected, sha256(token))) return null;
  if (application.status !== 'approved') return null;
  const type = application.type as ApplicationType;
  if (!APPLICATION_DEFINITIONS[type]) return null;
  return { ref, application, type, definition: APPLICATION_DEFINITIONS[type] };
}

async function fetchVerifiedMarkdown(url: string, expectedHash: string) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Published agreement unavailable (${response.status})`);
  const source = await response.text();
  const actualHash = sha256(source);
  if (!safeEqual(actualHash, expectedHash)) throw new Error('Published agreement hash does not match the approved version.');
  return source;
}

function withSessionCookie(response: NextResponse, token?: string) {
  if (token) response.cookies.set(DSH_SPMT_COOKIE, token, cookieOptions);
  return response;
}

export async function GET(request: NextRequest) {
  const fields = requestFields(request);
  const offer = await loadOffer(fields.serverId, fields.applicationId, fields.token);
  if (!offer) return NextResponse.json({ error: 'Agreement link is invalid, expired, or no longer eligible.' }, { status: 404 });

  const accepted = offer.application.agreementAcceptance || null;
  if (fields.format === 'document') {
    try {
      const source = accepted?.documentSourceMarkdown || await fetchVerifiedMarkdown(offer.definition.termsUrl, offer.definition.termsHash);
      return new NextResponse(source, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          ...(request.nextUrl.searchParams.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="${offer.type}-community-terms.md"` } : {}),
        },
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Agreement unavailable.' }, { status: 503 });
    }
  }

  if (fields.format === 'receipt') {
    if (!accepted) return NextResponse.json({ error: 'No acceptance receipt exists.' }, { status: 404 });
    const receipt = { ...accepted };
    delete receipt.documentSourceMarkdown;
    delete receipt.acceptanceScheduleSourceMarkdown;
    return new NextResponse(JSON.stringify(receipt, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="spmt-acceptance-${accepted.acceptanceId}.json"` },
    });
  }

  let session: any = null;
  let refreshedToken = '';
  const sessionToken = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (sessionToken) {
    try {
      const resolved = await resolveSpmtSession(sessionToken);
      session = resolved.session;
      if (resolved.token !== sessionToken) refreshedToken = resolved.token;
    } catch {}
  }

  return withSessionCookie(NextResponse.json({
    applicationId: fields.applicationId,
    role: offer.type,
    roleName: offer.definition.name,
    applicantDiscordId: offer.application.userId,
    document: {
      title: offer.definition.termsTitle,
      version: '2026-08-02',
      effectiveDate: '2026-08-02',
      hash: offer.definition.termsHash,
      sourceUrl: offer.definition.termsUrl,
      viewUrl: `${request.nextUrl.pathname}?${new URLSearchParams({ ...fields, format: 'document' })}`,
    },
    acceptanceSchedule: ACCEPTANCE_SCHEDULE,
    authenticated: Boolean(session),
    account: session ? {
      spmtUserId: session.spmtUserId,
      username: session.discordDisplayName || session.discordUsername || session.spmtUsername,
      discordUserId: session.discordUserId,
      avatarUrl: session.discordAvatar || '',
    } : null,
    identityMatches: Boolean(session && String(session.discordUserId) === String(offer.application.userId)),
    accepted: accepted ? {
      acceptanceId: accepted.acceptanceId,
      acceptedAt: accepted.acceptedAt,
      receiptUrl: `${request.nextUrl.pathname}?${new URLSearchParams({ ...fields, format: 'receipt' })}`,
    } : null,
  }), refreshedToken || undefined);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const serverId = String(body.serverId || '');
  const applicationId = String(body.applicationId || '');
  const token = String(body.token || '');
  const offer = await loadOffer(serverId, applicationId, token);
  if (!offer) return NextResponse.json({ error: 'Agreement link is invalid, expired, or no longer eligible.' }, { status: 404 });
  if (offer.application.agreementAcceptance) return NextResponse.json({ success: true, acceptance: offer.application.agreementAcceptance, alreadyAccepted: true });
  if (body.reviewedTerms !== true || body.electronicConsent !== true) {
    return NextResponse.json({ error: 'Both review and electronic-record consent confirmations are required.' }, { status: 400 });
  }

  const sessionToken = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!sessionToken) return NextResponse.json({ error: 'Authorize with SPMT before accepting.' }, { status: 401 });
  let resolved;
  try {
    resolved = await resolveSpmtSession(sessionToken);
  } catch {
    return NextResponse.json({ error: 'SPMT authorization expired. Sign in again.' }, { status: 401 });
  }
  const session = resolved.session;
  if (!session.spmtUserId || String(session.discordUserId || '') !== String(offer.application.userId || '')) {
    return NextResponse.json({ error: 'The authorized SPMT account is not linked to the approved Discord applicant.' }, { status: 403 });
  }

  try {
    const [documentSourceMarkdown, acceptanceScheduleSourceMarkdown] = await Promise.all([
      fetchVerifiedMarkdown(offer.definition.termsUrl, offer.definition.termsHash),
      fetchVerifiedMarkdown(ACCEPTANCE_SCHEDULE.url, ACCEPTANCE_SCHEDULE.hash),
    ]);
    const now = new Date().toISOString();
    const acceptanceId = randomUUID();
    const fingerprintKey = process.env.DSH_CLIENT_SECRET || process.env.DISCORD_BOT_TOKEN || 'dsh-local-unconfigured';
    const acceptance = {
      acceptanceId,
      applicationId,
      serverId,
      role: offer.type,
      flowVersion: offer.application.flowVersion || '2.0',
      spmtUserId: String(session.spmtUserId),
      discordUserId: String(session.discordUserId),
      username: String(session.discordUsername || session.spmtUsername || offer.application.username || ''),
      displayName: String(session.discordDisplayName || session.discordUsername || offer.application.displayName || ''),
      avatarUrl: String(session.discordAvatar || offer.application.avatarUrl || ''),
      authenticatedBy: 'SPMT OAuth',
      sessionFingerprint: createHmac('sha256', fingerprintKey).update(sessionToken).digest('hex'),
      presentedAt: String(offer.application.agreementOffer?.sentAt || now),
      acceptedAt: now,
      document: { title: offer.definition.termsTitle, version: '2026-08-02', effectiveDate: '2026-08-02', url: offer.definition.termsUrl, hash: offer.definition.termsHash },
      acceptanceSchedule: ACCEPTANCE_SCHEDULE,
      confirmations: {
        reviewedTerms: true,
        electronicConsent: true,
        authorizeButton: 'Authorize to sign',
        acceptanceButton: 'Accept Community Terms',
      },
      documentSourceMarkdown,
      acceptanceScheduleSourceMarkdown,
      receiptPath: `/api/applications/agreement?serverId=${encodeURIComponent(serverId)}&applicationId=${encodeURIComponent(applicationId)}&token=${encodeURIComponent(token)}&format=receipt`,
    };
    await db.collection('servers').doc(serverId).collection('applications').doc(applicationId).collection('acceptances').doc(acceptanceId).set(acceptance);
    await offer.ref.update({
      agreementAcceptance: acceptance,
      agreementStatus: 'accepted',
      roleActivationStatus: 'ready_for_onboarding',
      stateHistory: [...(offer.application.stateHistory || []), { status: 'terms_accepted', at: now, actorId: String(session.discordUserId) }],
    });
    return withSessionCookie(NextResponse.json({ success: true, acceptance }), resolved.token !== sessionToken ? resolved.token : undefined);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Acceptance could not be recorded.' }, { status: 503 });
  }
}
