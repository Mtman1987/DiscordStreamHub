import { NextRequest, NextResponse } from 'next/server';
import { getRuntimePublicUrl } from '@/lib/runtime-config';
import {
  MAX_STREAMWEAVER_MEDIA_BYTES,
  validateUploadedGifConversion,
} from '@/lib/uploaded-media-gif-validation';
import { convertUploadedMp4ToGif } from '@/lib/uploaded-media-gif-service';
import { verifyStreamWeaverSessionToken } from '@/lib/streamweaver-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const sessionToken = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const session = await verifyStreamWeaverSessionToken(sessionToken);
  if (!session) return NextResponse.json({ success: false, error: 'Invalid or expired StreamWeaver session.' }, { status: 401 });

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_STREAMWEAVER_MEDIA_BYTES + 1024 * 1024) {
    return NextResponse.json({ success: false, error: 'MP4 uploads are limited to 60 MB.' }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const slot = String(formData.get('slot') || '').trim();
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'An MP4 file is required.' }, { status: 400 });
    }
    const validationError = validateUploadedGifConversion({
      tenantId: session.id,
      slot,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
    if (validationError) {
      return NextResponse.json({ success: false, error: validationError }, { status: validationError.includes('60 MB') ? 413 : 400 });
    }

    const converted = await convertUploadedMp4ToGif({
      bytes: Buffer.from(await file.arrayBuffer()),
      tenantId: session.id,
      slot,
    });
    const baseUrl = getRuntimePublicUrl('baseUrl').replace(/\/$/, '');
    return NextResponse.json({
      success: true,
      url: `${baseUrl}${converted.relativeUrl}`,
      format: 'gif',
      bytes: converted.bytes,
      source: 'discord-stream-hub',
    });
  } catch (error) {
    console.error('[StreamWeaver GIF Conversion] Failed:', error);
    return NextResponse.json({ success: false, error: 'MP4 conversion failed.' }, { status: 500 });
  }
}
