import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getHardcodedAdminDiscordId } from '@/lib/runtime-config';

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

    if (!isOwner(String(serverId), String(reviewerId))) {
      return NextResponse.json({ error: 'Only the server owner can approve or reject applications' }, { status: 403 });
    }

    const appRef = db.collection('servers').doc(serverId).collection('applications').doc(applicationId);
    const appDoc = await appRef.get();

    if (!appDoc.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    await appRef.update({
      status,
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewerId,
    });

    return NextResponse.json({ success: true, application: { id: applicationId, ...appDoc.data() } });
  } catch (error) {
    console.error('Error updating application decision:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
