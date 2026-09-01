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
const GIF_WIDTH = 1280;
const GIF_HEIGHT = 800;
const GIF_FPS = 12;
const GIF_SECONDS = 4;
const GIF_FRAMES = GIF_FPS * GIF_SECONDS;

function decodeSource(body: any): Buffer {
  const raw = String(body?.imageBase64 || body?.image || '').trim();
  if (!raw) throw new Error('imageBase64 is required');
  const match = raw.match(/^data:[^;,]+;base64,(.+)$/i);
  const encoded = match ? match[1] : raw;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new Error('Source image is empty');
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Source image exceeds 20MB');
  return bytes;
}

async function runFfmpeg(args: string[]) {
  await execFileAsync('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024 });
}

async function renderLoopGif(masterPath: string, workDir: string) {
  const frameDir = join(workDir, 'frames');
  const palettePath = join(workDir, 'palette.png');
  const gifPath = join(workDir, 'hover.gif');
  await mkdir(frameDir, { recursive: true });

  const framePattern = join(frameDir, 'frame_%03d.png');
  const motionFrames = GIF_FRAMES - 1;
  const denominator = Math.max(1, motionFrames - 1);
  const zoom = `1+0.018*pow(sin(PI*on/${denominator}),2)`;
  const x = `(iw-iw/zoom)/2+2*sin(2*PI*on/${denominator})`;
  const y = `(ih-ih/zoom)/2+4*sin(2*PI*on/${denominator})`;

  await runFfmpeg([
    '-y', '-loop', '1', '-i', masterPath,
    '-vf', `zoompan=z='${zoom}':x='${x}':y='${y}':d=${motionFrames}:s=${GIF_WIDTH}x${GIF_HEIGHT}:fps=${GIF_FPS},eq=brightness='0.012*pow(sin(PI*n/${denominator}),2)':saturation='1+0.015*pow(sin(PI*n/${denominator}),2)':eval=frame`,
    '-frames:v', String(motionFrames), framePattern,
  ]);

  await copyFile(join(frameDir, 'frame_000.png'), join(frameDir, `frame_${String(GIF_FRAMES - 1).padStart(3, '0')}.png`));

  await runFfmpeg([
    '-y', '-framerate', String(GIF_FPS), '-i', framePattern,
    '-vf', 'palettegen=max_colors=160:stats_mode=diff', palettePath,
  ]);
  await runFfmpeg([
    '-y', '-framerate', String(GIF_FPS), '-i', framePattern, '-i', palettePath,
    '-filter_complex', 'paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', '-gifflags', '+transdiff', gifPath,
  ]);

  return readFile(gifPath);
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
    const hover = await renderLoopGif(masterPath, workDir);

    return NextResponse.json({
      success: true,
      renderer: 'dsh-sharp-ffmpeg',
      static: { mimeType: 'image/webp', width: MASTER_WIDTH, height: MASTER_HEIGHT, base64: master.toString('base64') },
      hover: {
        mimeType: 'image/gif', width: GIF_WIDTH, height: GIF_HEIGHT, fps: GIF_FPS,
        durationSeconds: GIF_SECONDS, frameCount: GIF_FRAMES, firstAndLastFrameMatch: true,
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
