import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { generateLeaderboardImage } from '@/ai/flows/generate-leaderboard-image';
import { getServerBranding } from '@/lib/server-branding';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const { serverId } = await params;
    const branding = await getServerBranding(serverId);
    const image = await generateLeaderboardImage(serverId, branding);
    if (!image) return new NextResponse(null, { status: 204 });

    const bytes = Buffer.from(image.replace(/^data:image\/png;base64,/, ''), 'base64');
    // Puppeteer captures the layout box, which can include transparent space
    // below the actual leaderboard content. Trim that space before the image
    // is placed into a 16:9 browser-source canvas.
    const cropped = await sharp(bytes).trim().png().toBuffer();
    return new NextResponse(new Uint8Array(cropped), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('[headless leaderboard image] failed to render:', error);
    return new NextResponse(null, { status: 204 });
  }
}
