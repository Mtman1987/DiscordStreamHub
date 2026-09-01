import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, unlink, rename, statfs } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getStoragePath } from '@/lib/runtime-config';
import { getClipWorkerSecret } from '@/lib/runtime-secrets';
import { BANNER_VERSION, normalizeBannerVariant } from '@/lib/banner-policy';

const STORAGE_PATH = getStoragePath();
const MAX_GIFS_PER_STREAMER = 10;
const MAX_GIF_UPLOAD_BYTES = 50 * 1024 * 1024;
const SQLITE_RESERVED_FREE_BYTES = 512 * 1024 * 1024;

function normalizeStreamerName(value: string): string {
  return String(value || '').trim().toLowerCase();
}

async function assertStorageHeadroom(incomingBytes: number) {
  const stats = await statfs(STORAGE_PATH);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const requiredBytes = incomingBytes + SQLITE_RESERVED_FREE_BYTES;
  if (freeBytes < requiredBytes) {
    const error = new Error(`Insufficient clip storage headroom: ${freeBytes} free, ${requiredBytes} required`);
    (error as any).code = 'DSH_STORAGE_RESERVE';
    throw error;
  }
}

async function writeGifAndMetadataAtomically(gifPath: string, metaPath: string, buffer: Buffer, metadata: Record<string, unknown>) {
  const suffix = `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const tempGifPath = `${gifPath}${suffix}`;
  const tempMetaPath = `${metaPath}${suffix}`;
  try {
    await writeFile(tempGifPath, buffer);
    await writeFile(tempMetaPath, JSON.stringify(metadata, null, 2));
    // Publish metadata before the GIF. Readers enumerate *.gif files, so a newly
    // published GIF can never become visible without its metadata already present.
    await rename(tempMetaPath, metaPath);
    await rename(tempGifPath, gifPath);
  } catch (error) {
    await Promise.all([
      unlink(tempGifPath).catch(() => {}),
      unlink(tempMetaPath).catch(() => {}),
    ]);
    throw error;
  }
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
    const bannerVariant = formData.get('bannerVariant') as string | null;
    const bannerVersion = formData.get('bannerVersion') as string | null;
    const nebulaGameId = formData.get('nebulaGameId') as string | null;
    const nebulaGameName = formData.get('nebulaGameName') as string | null;
    const nebulaOrder = formData.get('nebulaOrder') as string | null;
    const nebulaRevision = formData.get('nebulaRevision') as string | null;
    const nebulaCaptureSeconds = formData.get('nebulaCaptureSeconds') as string | null;
    const nebulaSourceUrl = formData.get('nebulaSourceUrl') as string | null;

    if (!file || (!streamer && !bannerName && !nebulaGameId)) {
      return NextResponse.json({ error: 'gif and streamer/bannerName/nebulaGameId required' }, { status: 400 });
    }
    if (file.size > MAX_GIF_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'GIF uploads are limited to 50 MB.' }, { status: 413 });
    }

    if (!existsSync(STORAGE_PATH)) await mkdir(STORAGE_PATH, { recursive: true });

    if (nebulaGameId) {
      const { normalizeNebulaGameId, NEBULA_GAMEPLAY_DIRECTORY } = await import('@/lib/nebula-gameplay-rotation');
      const normalizedGameId = normalizeNebulaGameId(nebulaGameId);
      if (!normalizedGameId || !nebulaRevision) {
        return NextResponse.json({ error: 'invalid Nebula gameplay metadata' }, { status: 400 });
      }
      const gameplayDir = join(STORAGE_PATH, NEBULA_GAMEPLAY_DIRECTORY);
      if (!existsSync(gameplayDir)) await mkdir(gameplayDir, { recursive: true });
      await assertStorageHeadroom(file.size);
      const buffer = Buffer.from(await file.arrayBuffer());
      const gifPath = join(gameplayDir, `${normalizedGameId}.gif`);
      const metaPath = join(gameplayDir, `${normalizedGameId}.gif.meta.json`);
      await writeGifAndMetadataAtomically(gifPath, metaPath, buffer, {
        id: normalizedGameId,
        name: String(nebulaGameName || normalizedGameId).slice(0, 100),
        order: Math.max(0, Number(nebulaOrder || 0)),
        revision: String(nebulaRevision).slice(0, 100),
        captureSeconds: Math.min(60, Math.max(1, Number(nebulaCaptureSeconds || 60))),
        capturedAt: new Date().toISOString(),
        sourceUrl: String(nebulaSourceUrl || '').slice(0, 1000),
      });
      const gifUrl = `/api/media/${NEBULA_GAMEPLAY_DIRECTORY}/${normalizedGameId}.gif`;
      console.log(`[ClipUpload] Saved Nebula gameplay ${normalizedGameId}.gif (${(buffer.length / 1024).toFixed(0)}KB)`);
      return NextResponse.json({ success: true, gifUrl, gameId: normalizedGameId });
    }

    if (bannerName) {
      const normalizedBannerName = bannerName.trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,64}$/.test(normalizedBannerName)) {
        return NextResponse.json({ error: 'invalid bannerName' }, { status: 400 });
      }
      if (bannerVersion !== BANNER_VERSION) {
        return NextResponse.json({ error: 'stale banner generator version' }, { status: 409 });
      }
      if (!bannerVariant || !['commander', 'crew', 'mountaineer'].includes(bannerVariant)) {
        return NextResponse.json({ error: 'invalid bannerVariant' }, { status: 400 });
      }

      const bannersDir = join(STORAGE_PATH, 'banners');
      if (!existsSync(bannersDir)) {
        await mkdir(bannersDir, { recursive: true });
      }

      await assertStorageHeadroom(file.size);
      const buffer = Buffer.from(await file.arrayBuffer());
      const gifPath = join(bannersDir, `${normalizedBannerName}.gif`);
      const metaPath = join(bannersDir, `${normalizedBannerName}.gif.meta.json`);
      await writeGifAndMetadataAtomically(gifPath, metaPath, buffer, {
        generatedAt: new Date().toISOString(),
        source: 'clip-worker',
        variant: normalizeBannerVariant(bannerVariant),
        version: bannerVersion,
      });

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

    // Enforce the canonical 10-GIF rotation limit, deleting oldest first. Do
    // this before the reserve check so replacement uploads can reclaim space.
    const existing = (await readdir(streamerDir)).filter(f => f.endsWith('.gif')).sort();
    if (existing.length >= MAX_GIFS_PER_STREAMER) {
      const toDelete = existing.slice(0, existing.length - (MAX_GIFS_PER_STREAMER - 1));
      for (const old of toDelete) {
        await unlink(join(streamerDir, old)).catch(() => {});
      }
    }

    await assertStorageHeadroom(file.size);

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
    if ((error as any)?.code === 'DSH_STORAGE_RESERVE' || (error as any)?.code === 'ENOSPC') {
      return NextResponse.json({ error: 'Clip storage is at its safety reserve; upload paused to protect the database.' }, { status: 507 });
    }
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
