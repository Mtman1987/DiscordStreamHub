import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/server-init';
import { deleteGif } from '@/lib/firebase-storage-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    
    if (!serverId) {
      return NextResponse.json({ error: 'Server ID required' }, { status: 400 });
    }

    // Get current spotlight
    const spotlightRef = db.collection('servers').doc(serverId).collection('spotlight').doc('current');
    const spotlightDoc = await spotlightRef.get();
    
    if (!spotlightDoc.exists) {
      return NextResponse.json({ error: 'No spotlight found' }, { status: 404 });
    }

    const spotlightData = spotlightDoc.data();
    const gifUrl = spotlightData?.cardGifUrl;
    
    if (gifUrl) {
      // Delete from Firebase Storage
      try {
        const gifFileName = gifUrl.split('/').pop()?.split('?')[0];
        if (gifFileName) {
          await deleteGif(decodeURIComponent(gifFileName));
        }
      } catch (error) {
        console.log(`Failed to delete GIF from storage: ${error}`);
      }
    }

    // Delete spotlight document
    await spotlightRef.delete();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Spotlight deleted successfully' 
    });
    
  } catch (error) {
    console.error('Delete spotlight error:', error);
    return NextResponse.json({ 
      error: 'Failed to delete spotlight'
    }, { status: 500 });
  }
}