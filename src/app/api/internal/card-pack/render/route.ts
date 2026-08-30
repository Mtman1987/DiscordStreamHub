import { NextRequest, NextResponse } from 'next/server';
import { createCardPackRenderJob, getCardPackRenderJob } from '@/lib/card-pack-render-jobs';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  return hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets());
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const job = await createCardPackRenderJob({
      eventId: String(body?.eventId || ''),
      source: String(body?.source || 'card-pack'),
      renderUrl: String(body?.renderUrl || ''),
    });
    return NextResponse.json({ success: true, job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const job = await getCardPackRenderJob(request.nextUrl.searchParams.get('id'));
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, job });
}
