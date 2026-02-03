import { NextRequest, NextResponse } from 'next/server';
import { convertMp4sToGifs } from '@/lib/clip-seeding-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, concurrency = 2 } = await request.json();
    
    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    console.log(`[ConvertGifs] Starting GIF conversion (${concurrency} at a time)...`);
    await convertMp4sToGifs(serverId, concurrency);

    return NextResponse.json({ success: true, message: 'GIFs converted' });
  } catch (error) {
    console.error('[ConvertGifs] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
