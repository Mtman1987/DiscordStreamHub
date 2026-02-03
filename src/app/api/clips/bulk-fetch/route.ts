import { NextRequest, NextResponse } from 'next/server';
import { bulkFetchClips } from '@/lib/clip-rotation-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();

    if (!serverId) {
      return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    console.log(`[BulkFetch] Starting bulk clip fetch for server ${serverId}`);
    
    // Start the process without awaiting
    bulkFetchClips(serverId).catch(err => {
      console.error('[BulkFetch] Background error:', err);
    });

    // Return immediately
    return NextResponse.json({ 
      success: true, 
      message: 'Bulk clip fetch started in background. Check server logs for progress.' 
    });
  } catch (error) {
    console.error('[BulkFetch] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: String(error) 
    }, { status: 500 });
  }
}
