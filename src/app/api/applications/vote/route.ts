import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { serverId, applicationId, adminId, odminId, adminName, vote } = await req.json();
    const voterId = adminId || odminId;

    if (!serverId || !applicationId || !voterId || !vote) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (vote !== 'approve' && vote !== 'reject') {
      return NextResponse.json({ error: 'Vote must be "approve" or "reject"' }, { status: 400 });
    }

    const voteRef = db.collection('servers').doc(serverId)
      .collection('applications').doc(applicationId)
      .collection('votes').doc(voterId);

    const existing = await voteRef.get();

    if (existing.exists && existing.data()?.vote === vote) {
      // Toggle off — remove vote
      await voteRef.delete();
      return NextResponse.json({ success: true, action: 'removed' });
    }

    await voteRef.set({
      adminId: voterId,
      adminName: adminName || 'Admin',
      vote,
      votedAt: new Date(),
    });

    return NextResponse.json({ success: true, action: 'voted' });
  } catch (error) {
    console.error('Error recording vote:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
