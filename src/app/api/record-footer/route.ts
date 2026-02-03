import { NextRequest, NextResponse } from 'next/server';
import { generateFooterGif } from '@/lib/footer-recording-service';

export async function POST(request: NextRequest) {
  try {
    const { footerUrl, fileName } = await request.json();
    
    if (!footerUrl || !fileName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log(`Starting footer recording for ${fileName}...`);
    
    const footerResult = await generateFooterGif(footerUrl, fileName);
    
    if (!footerResult) {
      return NextResponse.json({ error: 'Failed to generate footer recording' }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true,
      gifUrl: footerResult.gifUrl,
      mp4Url: footerResult.mp4Url,
      message: `Footer recorded for ${fileName}`
    });
  } catch (error) {
    console.error('Error recording footer:', error);
    return NextResponse.json({ 
      error: 'Failed to record footer',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}