import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = (process.env.CLIP_WORKER_URL || 'https://dsh-clip-worker.fly.dev').replace(/\/$/, '');
const WORKER_SECRET = process.env.CLIP_WORKER_SECRET || process.env.BOT_SECRET_KEY || '1234';

export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${WORKER_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const response = await fetch(`${WORKER_URL}/api/banners/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WORKER_SECRET}`,
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
