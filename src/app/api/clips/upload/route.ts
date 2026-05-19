import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const STORAGE_PATH = process.env.STORAGE_PATH || '/data/clips';
const MAX_GIFS_PER_STREAMER = 5;
const WORKER_SECRET = process.env.CLIP_WORKER_SECRET || process.env.BOT_SECRET_KEY || '1234';

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${WORKER_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';

    // JSON body = cooldown marking from worker
    if (contentType.includes('application/json')) {
      const { markCooldown, serverId, discordUserId } = await request.json();
      if (markCooldown && serverId && discordUserId) {
        const { db } = await import('@/lib/db');
        await db.collection('servers').doc(serverId)
          .collection('users').doc(discordUserId)
          .update({ lastClipFetch: Date.now() });
        return NextResponse.json({ success: true, cooldownSet: true });
      }
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // FormData = GIF upload from worker
    const formData = await request.formData();
    const file = formData.get('gif') as File | null;
    const streamer = formData.get('streamer') as string | null;

    if (!file || !streamer) {
      return NextResponse.json({ error: 'gif and streamer required' }, { status: 400 });
    }

    const streamerDir = join(STORAGE_PATH, streamer);
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

    const gifUrl = `/api/media/${streamer}/${timestamp}.gif`;
    console.log(`[ClipUpload] Saved ${streamer}/${timestamp}.gif (${(buffer.length / 1024).toFixed(0)}KB)`);

    return NextResponse.json({ success: true, gifUrl });
  } catch (error) {
    console.error('[ClipUpload] Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${WORKER_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { streamer } = await request.json();
    if (!streamer) {
      return NextResponse.json({ error: 'streamer required' }, { status: 400 });
    }

    const streamerDir = join(STORAGE_PATH, streamer);
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

    console.log(`[ClipUpload] Deleted stale folder: ${streamer} (${files.length} files)`);
    return NextResponse.json({ success: true, deleted: files.length });
  } catch (error) {
    console.error('[ClipUpload] DELETE error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
