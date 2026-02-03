import { NextRequest, NextResponse } from 'next/server';
import { generateCrewBanners, generateCommanderBanner } from '@/lib/banner-generation-service';

export async function POST(request: NextRequest) {
  try {
    console.log('[GenerateBanners] Starting banner generation...');
    
    const crewMembers = [
      'Akhiteddy',
      'differentdecree',
      'swordsmanEB',
      'brotherdavid09',
      'MotherMiranda',
      'UDHero2K',
      'Scarletkitty1313'
    ];
    
    // Generate commander banner first
    const commanderUrl = await generateCommanderBanner();
    
    // Generate crew banners
    await generateCrewBanners(crewMembers);

    return NextResponse.json({ 
      success: true, 
      message: 'All banners generated',
      commanderUrl,
      crewCount: crewMembers.length
    });
  } catch (error) {
    console.error('[GenerateBanners] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
