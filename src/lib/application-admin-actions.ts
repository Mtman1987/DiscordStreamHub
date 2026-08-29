import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { APPLICATION_DEFINITIONS, type ApplicationType } from '@/lib/application-flow';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

const OWNER_ROLE_ID = '1283213615939194955';

export type ApplicationDecision = 'approved' | 'rejected';

export function isApplicationOwner(serverId: string, userId: string): boolean {
  if (!serverId || !userId) return false;
  const server = db.get('servers', serverId) || {};
  const user = db.get(`servers/${serverId}/users`, userId) || {};
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  return userId === getHardcodedAdminDiscordId()
    || userId === String(server.ownerId || '').trim()
    || roles.includes(OWNER_ROLE_ID);
}

export async function decideApplication(input: {
  serverId: string;
  applicationId: string;
  reviewerId: string;
  status: ApplicationDecision;
}) {
  if (!isApplicationOwner(input.serverId, input.reviewerId)) {
    throw new Error('Only the server owner can approve or reject applications.');
  }
  const appRef = db.collection('servers').doc(input.serverId).collection('applications').doc(input.applicationId);
  const appDoc = await appRef.get();
  if (!appDoc.exists) throw new Error('Application not found.');

  const now = new Date().toISOString();
  const application = appDoc.data() || {};
  if (application.status === input.status && application.archiveReason === 'final-decision') {
    return { id: input.applicationId, ...application };
  }
  const nextHistory = [
    ...(Array.isArray(application.stateHistory) ? application.stateHistory : []),
    { status: input.status, at: now, actorId: input.reviewerId },
    { status: 'archived', decisionStatus: input.status, at: now, actorId: input.reviewerId, reason: 'final-decision' },
  ];
  const updates = {
    status: input.status,
    reviewedAt: now,
    reviewedBy: input.reviewerId,
    archivedAt: now,
    archivedBy: input.reviewerId,
    archiveReason: 'final-decision',
    stateHistory: nextHistory,
  };
  await appRef.update(updates);
  return { id: input.applicationId, ...application, ...updates };
}

export async function notifyApplicationDecision(input: {
  serverId: string;
  applicationId: string;
  ownerId: string;
  status: ApplicationDecision;
  expectedUserId?: string;
}) {
  if (!isApplicationOwner(input.serverId, input.ownerId)) {
    throw new Error('Only the server owner may send a final application decision.');
  }
  const appRef = db.collection('servers').doc(input.serverId).collection('applications').doc(input.applicationId);
  const appDoc = await appRef.get();
  if (!appDoc.exists) throw new Error('Application not found.');
  const application = appDoc.data() || {};
  const type = application.type as ApplicationType;
  const definition = APPLICATION_DEFINITIONS[type];
  if (!definition || application.status !== input.status) {
    throw new Error('Application type or decision state does not match.');
  }
  if (input.expectedUserId && String(input.expectedUserId) !== String(application.userId)) {
    throw new Error('Applicant identity does not match.');
  }
  if (
    application.notificationStatus === 'delivered'
    && application.status === input.status
    && application.notifiedAt
  ) {
    return {
      success: true as const,
      duplicate: true,
      messageId: String(application.notificationMessageId || ''),
      userId: String(application.userId || ''),
      type,
    };
  }

  const botToken = process.env.DISCORD_BOT_TOKEN || '';
  if (!botToken) throw new Error('Discord bot token is not configured.');
  const dmResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: application.userId }),
  });
  if (!dmResponse.ok) throw new Error('Could not open the applicant DM.');
  const dm = await dmResponse.json();
  const serverDoc = await db.collection('servers').doc(input.serverId).get();
  const brandingDoc = await db.collection('servers').doc(input.serverId).collection('config').doc('branding').get();
  const serverName = brandingDoc.data()?.serverName || serverDoc.data()?.serverName || 'SPMT';
  const templates = (await db.collection('servers').doc(input.serverId).collection('config').doc('dmTemplates').get()).data() || {};
  const key = `${type}${input.status === 'approved' ? 'Approved' : 'Rejected'}`;
  const customMessage = String(templates[key] || '').trim();
  const now = new Date().toISOString();

  let payload: any;
  if (input.status === 'approved') {
    const rawToken = randomBytes(32).toString('base64url');
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://discord-stream-hub-new.fly.dev').replace(/\/$/, '');
    const agreementUrl = `${baseUrl}/agreements/accept?${new URLSearchParams({ serverId: input.serverId, applicationId: input.applicationId, token: rawToken })}`;
    const offer = {
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      sentAt: now,
      sentBy: input.ownerId,
      documentTitle: definition.termsTitle,
      documentHash: definition.termsHash,
      status: 'awaiting_acceptance',
    };
    await appRef.update({
      agreementOffer: offer,
      agreementStatus: 'awaiting_acceptance',
      stateHistory: [...(application.stateHistory || []), { status: 'agreement_sent', at: now, actorId: input.ownerId }],
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
        footer: { text: 'SPMT • Owner-approved participation flow' },
        timestamp: now,
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
      description: customMessage || 'Thank you for your interest. The Owner is not moving forward with this application at this time.',
      color: 0x6d5dfc,
      fields: [{ name: 'What this means', value: 'This decision applies to the current application. You remain welcome in the community and may ask whether a future application would be appropriate.' }],
      footer: { text: `Thank you for your interest in ${serverName}` },
      timestamp: now,
    }] };
  }

  const sent = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!sent.ok) throw new Error('Discord rejected the decision DM.');
  const sentMessage = await sent.json().catch(() => ({}));
  await appRef.update({
    notificationStatus: 'delivered',
    notificationDecision: input.status,
    notificationMessageId: String(sentMessage?.id || ''),
    notifiedAt: now,
  });
  return { success: true as const, messageId: String(sentMessage?.id || ''), userId: String(application.userId || ''), type };
}
