import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getStoragePath } from '@/lib/runtime-config';

const execFileAsync = promisify(execFile);
const RETAINED_GIFS_PER_SLOT = 5;
let conversionTail: Promise<unknown> = Promise.resolve();

function safeTenantKey(tenantId: string): string {
  const normalized = String(tenantId || '').trim();
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(normalized)) return normalized;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function convertUploadedMp4ToGif(input: {
  bytes: Buffer;
  tenantId: string;
  slot: string;
}): Promise<{ relativeUrl: string; bytes: number }> {
  const conversion = conversionTail.catch(() => undefined).then(() => convertUploadedMp4ToGifInternal(input));
  conversionTail = conversion;
  return conversion;
}

async function convertUploadedMp4ToGifInternal(input: {
  bytes: Buffer;
  tenantId: string;
  slot: string;
}): Promise<{ relativeUrl: string; bytes: number }> {
  const conversionId = randomUUID();
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-streamweaver-gif-'));
  const inputPath = path.join(temporaryDirectory, `${conversionId}.mp4`);
  const outputPath = path.join(temporaryDirectory, `${conversionId}.gif`);
  const tenantKey = safeTenantKey(input.tenantId);
  const outputDirectory = path.join(getStoragePath(), 'streamweaver', tenantKey, input.slot);
  const outputName = `${Date.now()}-${conversionId.slice(0, 8)}.gif`;
  const storedPath = path.join(outputDirectory, outputName);

  try {
    await fs.writeFile(inputPath, input.bytes);
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    await execFileAsync(ffmpegPath, [
      '-y', '-i', inputPath,
      '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      '-loop', '0', outputPath,
    ], { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });

    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.copyFile(outputPath, storedPath);
    const outputStat = await fs.stat(storedPath);

    const existing = (await fs.readdir(outputDirectory))
      .filter((name) => name.endsWith('.gif'))
      .sort()
      .reverse();
    await Promise.all(existing.slice(RETAINED_GIFS_PER_SLOT).map((name) => fs.unlink(path.join(outputDirectory, name)).catch(() => undefined)));

    return {
      relativeUrl: `/api/media/streamweaver/${encodeURIComponent(tenantKey)}/${encodeURIComponent(input.slot)}/${encodeURIComponent(outputName)}`,
      bytes: outputStat.size,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
