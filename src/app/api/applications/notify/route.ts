import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { APPLICATION_DEFINITIONS, ApplicationType } from '@/lib/application-flow';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 30 };

function isOwner(serverId: string, userId: string) {
  const server = db.get('servers', serverId) || {};
  const user = db.get(`servers/${serverId}/users`, userId) || {};
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  return userId === getHardcodedAdminDiscordId() || userId === String(server.ownerId || '') || roles.includes('1283213615939194955');
}

function withCookie(response: NextResponse, token?: string) {
  if (token) response.cookies.set(DSH_SPMT_COOKIE, token, cookieOptions);
  return response;
}

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
    try { resolved = await resolveSpmtSession(sessionToken); }
    catch { return NextResponse.json({ error: 'SPMT owner authorization expired.' }, { status: 401 }); }
    const ownerId = String(resolved.session.discordUserId || '');
    if (!isOwner(serverId, ownerId)) return NextResponse.json({ error: 'Only the Owner may send a final application decision.' }, { status: 403 });

    const appRef = db.collection('servers').doc(serverId).collection('applications').doc(applicationId);
    const appDoc = await appRef.get();
    if (!appDoc.exists) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    const application = appDoc.data() || {};
    const type = application.type as ApplicationType;
    const definition = APPLICATION_DEFINITIONS[type];
    if (!definition || application.status !== status) return NextResponse.json({ error: 'Application type or decision state does not match.' }, { status: 409 });
    if (body.userId && String(body.userId) !== String(application.userId)) return NextResponse.json({ error: 'Applicant identity does not match.' }, { status: 409 });

    const botToken = process.env.DISCORD_BOT_TOKEN || '';
    if (!botToken) return NextResponse.json({ error: 'Discord bot token is not configured.' }, { status: 503 });
    const dmResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST', headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: application.userId }),
    });
    if (!dmResponse.ok) return NextResponse.json({ error: 'Could not open the applicant DM.' }, { status: 502 });
    const dm = await dmResponse.json();
    const serverDoc = await db.collection('servers').doc(serverId).get();
    const brandingDoc = await db.collection('servers').doc(serverId).collection('config').doc('branding').get();
    const serverName = brandingDoc.data()?.serverName || serverDoc.data()?.serverName || 'SPMT';
    const templates = (await db.collection('servers').doc(serverId).collection('config').doc('dmTemplates').get()).data() || {};
    const key = `${type}${status === 'approved' ? 'Approved' : 'Rejected'}`;
    const customMessage = String(templates[key] || '').trim();

    let payload: any;
    const now = new Date().toISOString();
    if (status === 'approved') {
      const rawToken = randomBytes(32).toString('base64url');
      const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://discord-stream-hub-new.fly.dev').replace(/\/$/, '');
      const agreementUrl = `${baseUrl}/agreements/accept?${new URLSearchParams({ serverId, applicationId, token: rawToken })}`;
      const offer = {
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        sentAt: now,
        sentBy: ownerId,
        documentTitle: definition.termsTitle,
        documentHash: definition.termsHash,
        status: 'awaiting_acceptance',
      };
      await appRef.update({
        agreementOffer: offer,
        agreementStatus: 'awaiting_acceptance',
        stateHistory: [...(application.stateHistory || []), { status: 'agreement_sent', at: now, actorId: ownerId }],
      });
      payload = {
        embeds: [{
          title: `✅ ${serverName} ${definition.name} Application Approved`,
          description: customMessage || `Thank you for applying. The Owner approved your ${definition.name.toLowerCase()} application.`,
          color: 0x38b26c,
          fields: [
            { name: 'Final step', value: 'Authorize with SPMT to verify your linked account, review the exact agreement, then separately click **Accept Community Terms**. OAuth alone is not acceptance.' },
            { name: 'Identity evidence', value: 'Your immutable SPMT/Discord IDs, displayed username/avatar, agreement hash, and UTC acceptance time will be recorded in your receipt.' },
          ],
          footer: { text: 'SPMT • Owner-approved participation flow' }, timestamp: now,
        }],
        components: [
          { type: 1, components: [{ type: 2, style: 5, label: 'Authorize to sign', url: agreementUrl }] },
          { type: 1, components: [
            { type: 2, style: 5, label: 'Read agreement', url: definition.termsUrl },
            { type: 2, style: 5, label: 'Download agreement', url: `${agreementUrl}&format=document&download=1` },
          ] },
        ],
      };
    } else {
      payload = { embeds: [{
        title: `SPMT ${definition.name} Application Update`,
        description: customMessage || `Thank you for your interest. The Owner is not moving forward with this application at this time.`,
        color: 0x6d5dfc,
        fields: [{ name: 'What this means', value: 'This decision applies to the current application. You remain welcome in the community and may ask whether a future application would be appropriate.' }],
        footer: { text: `Thank you for your interest in ${serverName}` }, timestamp: now,
      }] };
    }

    const sent = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST', headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!sent.ok) return NextResponse.json({ error: 'Discord rejected the decision DM.' }, { status: 502 });
    await appRef.update({ notificationStatus: 'delivered', notifiedAt: now });
    return withCookie(NextResponse.json({ success: true }), resolved.token !== sessionToken ? resolved.token : undefined);
  } catch (error) {
    console.error('[applications/notify]', error);
    return NextResponse.json({ error: 'Internal notification error.' }, { status: 500 });
  }
}
