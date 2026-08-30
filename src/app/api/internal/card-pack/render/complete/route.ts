import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { completeCardPackRenderJob } from '@/lib/card-pack-render-jobs';
import { getStoragePath } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  const secret = getClipWorkerSecret();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const form = await request.formData();
  const id = String(form.get('id') || '').trim();
  const gif = form.get('gif') as File | null;
  if (!id || !gif) return NextResponse.json({ error: 'id and gif are required' }, { status: 400 });

  const safeId = id.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, 120);
  if (!safeId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const directory = join(getStoragePath(), 'card-pack-reveals');
  if (!existsSync(directory)) await mkdir(directory, { recursive: true });
  const fileName = `${safeId}.gif`;
  const bytes = Buffer.from(await gif.arrayBuffer());
  await writeFile(join(directory, fileName), bytes);
  const job = await completeCardPackRenderJob(safeId, fileName);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  console.log(`[CardPackRender] Ready ${safeId} (${(bytes.length / 1024).toFixed(0)}KB)`);
  return NextResponse.json({ success: true, job });
}
