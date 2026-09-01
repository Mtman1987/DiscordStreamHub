import { NextRequest, NextResponse } from 'next/server';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const MASTER_WIDTH = 2048;
const MASTER_HEIGHT = 1280;
const GIF_WIDTH = 640;
const GIF_HEIGHT = 400;
const GIF_FPS = 10;
const GIF_FORWARD_SECONDS = 5;
const GIF_FORWARD_FRAMES = GIF_FPS * GIF_FORWARD_SECONDS;
const GIF_FRAMES = GIF_FORWARD_FRAMES * 2;
const GIF_SECONDS = GIF_FRAMES / GIF_FPS;
const MAX_RENDER_BYTES = 50 * 1024 * 1024;
const GIF_PALETTE_LEVELS = [128, 96, 80, 64] as const;

function decodeSource(body: any): Buffer {
  const raw = String(body?.imageBase64 || body?.image || '').trim();
  if (!raw) throw new Error('imageBase64 is required');
  const match = raw.match(/^data:[^;,]+;base64,(.+)$/i);
  const encoded = match ? match[1] : raw;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new Error('Source image is empty');
  if (bytes.length > MAX_RENDER_BYTES) throw new Error('Source image exceeds 50MB');
  return bytes;
}

async function runFfmpeg(args: string[]) {
  await execFileAsync('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024 });
}

async function encodeGif(framePattern: string, palettePath: string, gifPath: string, colors: number) {
  await runFfmpeg([
    '-y', '-framerate', String(GIF_FPS), '-start_number', '0', '-i', framePattern,
    '-vf', `palettegen=max_colors=${colors}:stats_mode=diff`, palettePath,
  ]);
  await runFfmpeg([
    '-y', '-framerate', String(GIF_FPS), '-start_number', '0', '-i', framePattern, '-i', palettePath,
    '-filter_complex', 'paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', '-gifflags', '+transdiff', gifPath,
  ]);
  return readFile(gifPath);
}

async function renderLoopGif(masterPath: string, workDir: string) {
  const frameDir = join(workDir, 'frames');
  const palettePath = join(workDir, 'palette.png');
  const gifPath = join(workDir, 'hover.gif');
  await mkdir(frameDir, { recursive: true });

  const framePattern = join(frameDir, 'frame_%03d.png');
  const denominator = Math.max(1, GIF_FORWARD_FRAMES - 1);
  const zoom = `1+0.018*on/${denominator}`;
  const x = `(iw-iw/zoom)/2+2*sin(PI*on/${denominator})`;
  const y = `(ih-ih/zoom)/2+4*sin(PI*on/${denominator})`;

  await runFfmpeg([
    '-y', '-loop', '1', '-i', masterPath,
    '-vf', `zoompan=z='${zoom}':x='${x}':y='${y}':d=${GIF_FORWARD_FRAMES}:s=${GIF_WIDTH}x${GIF_HEIGHT}:fps=${GIF_FPS},eq=brightness='0.012*on/${denominator}':saturation='1+0.015*on/${denominator}':eval=frame`,
    '-frames:v', String(GIF_FORWARD_FRAMES), '-start_number', '0', framePattern,
  ]);

  for (let reverseIndex = 0; reverseIndex < GIF_FORWARD_FRAMES; reverseIndex += 1) {
    const sourceIndex = GIF_FORWARD_FRAMES - 1 - reverseIndex;
    const targetIndex = GIF_FORWARD_FRAMES + reverseIndex;
    await copyFile(
      join(frameDir, `frame_${String(sourceIndex).padStart(3, '0')}.png`),
      join(frameDir, `frame_${String(targetIndex).padStart(3, '0')}.png`),
    );
  }

  let gif = Buffer.alloc(0);
  let paletteColors = GIF_PALETTE_LEVELS[0];
  for (const colors of GIF_PALETTE_LEVELS) {
    paletteColors = colors;
    gif = await encodeGif(framePattern, palettePath, gifPath, colors);
    if (gif.length <= MAX_RENDER_BYTES) break;
    console.warn(`[QuackverseArtRender] ${colors}-color GIF is ${(gif.length / 1024 / 1024).toFixed(2)}MB; retrying with a smaller palette.`);
  }

  if (gif.length > MAX_RENDER_BYTES) {
    throw new Error(`Hover GIF renderer output exceeded 50MB after optimization (${(gif.length / 1024 / 1024).toFixed(2)}MB)`);
  }

  return { gif, paletteColors };
}

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workDir = await mkdtemp(join(tmpdir(), 'dsh-quackverse-art-'));
  try {
    const body = await request.json().catch(() => ({}));
    const source = decodeSource(body);
    const master = await sharp(source, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .resize(MASTER_WIDTH, MASTER_HEIGHT, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
      .sharpen(0.8)
      .webp({ quality: 94, smartSubsample: true })
      .toBuffer();

    const masterPath = join(workDir, 'enhanced.webp');
    await writeFile(masterPath, master);
    const { gif: hover, paletteColors } = await renderLoopGif(masterPath, workDir);

    return NextResponse.json({
      success: true,
      renderer: 'dsh-sharp-ffmpeg-pingpong',
      static: { mimeType: 'image/webp', width: MASTER_WIDTH, height: MASTER_HEIGHT, base64: master.toString('base64') },
      hover: {
        mimeType: 'image/gif', width: GIF_WIDTH, height: GIF_HEIGHT, fps: GIF_FPS,
        durationSeconds: GIF_SECONDS, sourceMotionSeconds: GIF_FORWARD_SECONDS,
        frameCount: GIF_FRAMES, paletteColors, firstAndLastFrameMatch: true,
        base64: hover.toString('base64'),
      },
    });
  } catch (error: any) {
    console.error('[QuackverseArtRender] Failed:', error);
    return NextResponse.json({ error: error?.message || 'Quackverse art rendering failed' }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
