import { NextRequest, NextResponse } from 'next/server';
import { getClipWorkerUrl } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  try {
    const workerSecret = getClipWorkerSecret();
    if (!workerSecret) {
      return NextResponse.json({ error: 'Clip worker credential is not configured' }, { status: 503 });
    }
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${workerSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const response = await fetch(`${getClipWorkerUrl().replace(/\/$/, '')}/api/banners/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workerSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? JSON.parse(text || '{}')
      : { raw: text };

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error('[GenerateBanners] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
