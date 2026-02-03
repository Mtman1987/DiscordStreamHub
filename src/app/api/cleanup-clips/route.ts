import { NextRequest, NextResponse } from 'next/server';
import { cleanupAllOldClips, deleteClipFromPool } from '@/lib/clip-management-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, action, username, gifUrl } = await request.json();
    
    if (!serverId) {
      return NextResponse.json({ error: 'Server ID required' }, { status: 400 });
    }

    if (action === 'delete' && username && gifUrl) {
      const success = await deleteClipFromPool(serverId, { username }, gifUrl);
      if (success) {
        // Also clear the spotlight if this was the spotlight GIF
        const { db } = await import('@/firebase/server-init');
        const spotlightRef = db.collection('servers').doc(serverId).collection('spotlight').doc('current');
        const spotlightDoc = await spotlightRef.get();
        
        if (spotlightDoc.exists && spotlightDoc.data()?.cardGifUrl === gifUrl) {
          await spotlightRef.delete();
          console.log('[CleanupClips] Cleared spotlight after deleting GIF');
        }
        
        return NextResponse.json({ success: true, message: 'GIF deleted and spotlight cleared' });
      } else {
        return NextResponse.json({ error: 'GIF not found or could not be deleted' }, { status: 404 });
      }
    }
    
    const cleanedCount = await cleanupAllOldClips(serverId);
    
    return NextResponse.json({ 
      success: true, 
      message: `Cleaned up ${cleanedCount} old clips`,
      cleanedCount 
    });
    
  } catch (error) {
    console.error('Cleanup clips error:', error);
    return NextResponse.json({ 
      error: 'Failed to cleanup clips',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}