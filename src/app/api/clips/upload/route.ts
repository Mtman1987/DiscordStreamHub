import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getStoragePath } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';

const STORAGE_PATH = getStoragePath();
const MAX_GIFS_PER_STREAMER = 5;

function normalizeStreamerName(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const workerSecret = getClipWorkerSecret();
    if (!workerSecret) {
      return NextResponse.json({ error: 'Clip worker credential is not configured' }, { status: 503 });
    }
    // Auth check
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${workerSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';

    // JSON body = cooldown marking from worker
    if (contentType.includes('application/json')) {
      const { markCooldown, serverId, discordUserId } = await request.json();
      if (markCooldown && serverId && discordUserId) {
        const { db } = await import('@/lib/db');
        const now = Date.now();
        const normalizedId = String(discordUserId);
        if (normalizedId.startsWith('manual:')) {
          const manualId = normalizedId.slice('manual:'.length).trim();
          if (manualId) {
            await db.collection('servers').doc(serverId)
              .collection('manualDiscordShoutouts').doc(manualId)
              .set({
                lastGifRequestAt: now,
                needsGif: false,
                updatedAt: new Date().toISOString(),
              }, { merge: true });
          }
        } else {
          await db.collection('servers').doc(serverId)
            .collection('users').doc(normalizedId)
            .update({ lastClipFetch: now });
        }
        return NextResponse.json({ success: true, cooldownSet: true });
      }
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // FormData = GIF upload from worker
    const formData = await request.formData();
    const file = formData.get('gif') as File | null;
    const streamer = formData.get('streamer') as string | null;
    const bannerName = formData.get('bannerName') as string | null;

    if (!file || (!streamer && !bannerName)) {
      return NextResponse.json({ error: 'gif and streamer/bannerName required' }, { status: 400 });
    }

    if (bannerName) {
      const normalizedBannerName = bannerName.trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,64}$/.test(normalizedBannerName)) {
        return NextResponse.json({ error: 'invalid bannerName' }, { status: 400 });
      }

      const bannersDir = join(STORAGE_PATH, 'banners');
      if (!existsSync(bannersDir)) {
        await mkdir(bannersDir, { recursive: true });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const gifPath = join(bannersDir, `${normalizedBannerName}.gif`);
      const metaPath = join(bannersDir, `${normalizedBannerName}.gif.meta.json`);
      await writeFile(gifPath, buffer);
      await writeFile(metaPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: 'clip-worker',
      }, null, 2));

      const gifUrl = `/api/media/banners/${normalizedBannerName}.gif`;
      console.log(`[ClipUpload] Saved banner ${normalizedBannerName}.gif (${(buffer.length / 1024).toFixed(0)}KB)`);
      return NextResponse.json({ success: true, gifUrl, bannerName: normalizedBannerName });
    }

    const streamerName = normalizeStreamerName(streamer || '');
    if (!streamerName) {
      return NextResponse.json({ error: 'invalid streamer' }, { status: 400 });
    }
    const streamerDir = join(STORAGE_PATH, streamerName);
    if (!existsSync(streamerDir)) {
      await mkdir(streamerDir, { recursive: true });
    }

    // Enforce GIF limit — keep max 5, delete oldest
    const existing = (await readdir(streamerDir)).filter(f => f.endsWith('.gif')).sort();
    if (existing.length >= MAX_GIFS_PER_STREAMER) {
      const toDelete = existing.slice(0, existing.length - (MAX_GIFS_PER_STREAMER - 1));
      for (const old of toDelete) {
        await unlink(join(streamerDir, old)).catch(() => {});
      }
    }

    // Write the GIF
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const gifPath = join(streamerDir, `${timestamp}.gif`);
    await writeFile(gifPath, buffer);

    const gifUrl = `/api/media/${streamerName}/${timestamp}.gif`;
    console.log(`[ClipUpload] Saved ${streamerName}/${timestamp}.gif (${(buffer.length / 1024).toFixed(0)}KB)`);

    return NextResponse.json({ success: true, gifUrl });
  } catch (error) {
    console.error('[ClipUpload] Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const workerSecret = getClipWorkerSecret();
    if (!workerSecret) {
      return NextResponse.json({ error: 'Clip worker credential is not configured' }, { status: 503 });
    }
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${workerSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { streamer } = await request.json();
    const normalizedStreamer = normalizeStreamerName(streamer);
    if (!normalizedStreamer) {
      return NextResponse.json({ error: 'streamer required' }, { status: 400 });
    }

    const streamerDir = join(STORAGE_PATH, normalizedStreamer);
    if (!existsSync(streamerDir)) {
      return NextResponse.json({ success: true, message: 'Folder does not exist' });
    }

    // Delete all files in the folder
    const files = await readdir(streamerDir);
    for (const file of files) {
      await unlink(join(streamerDir, file)).catch(() => {});
    }

    // Remove the directory itself
    const { rmdir } = await import('fs/promises');
    await rmdir(streamerDir).catch(() => {});

    console.log(`[ClipUpload] Deleted stale folder: ${normalizedStreamer} (${files.length} files)`);
    return NextResponse.json({ success: true, deleted: files.length });
  } catch (error) {
    console.error('[ClipUpload] DELETE error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
