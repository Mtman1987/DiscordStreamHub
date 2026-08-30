import { NextRequest, NextResponse } from 'next/server';
import { claimNextCardPackRenderJob } from '@/lib/card-pack-render-jobs';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = getClipWorkerSecret();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const job = await claimNextCardPackRenderJob();
  return NextResponse.json({ success: true, job });
}
