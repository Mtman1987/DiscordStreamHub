import { NextRequest, NextResponse } from 'next/server';
import { seedMp4s } from '@/lib/clip-seeding-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    
    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    console.log('[SeedMp4s] Starting MP4 download...');
    await seedMp4s(serverId);

    return NextResponse.json({ success: true, message: 'MP4s downloaded' });
  } catch (error) {
    console.error('[SeedMp4s] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
