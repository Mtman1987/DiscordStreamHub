import { NextRequest, NextResponse } from 'next/server';
import { failCardPackRenderJob } from '@/lib/card-pack-render-jobs';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  const secret = getClipWorkerSecret();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const job = await failCardPackRenderJob(body?.id, body?.error);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  return NextResponse.json({ success: true, job });
}
