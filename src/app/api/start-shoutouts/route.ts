import { NextRequest, NextResponse } from 'next/server';
import { startAutomatedShoutouts } from '@/lib/automated-shoutout-system';

export async function POST(request: NextRequest) {
  try {
    const { serverId } = await request.json();
    
    if (!serverId) {
      return NextResponse.json({ error: 'Server ID required' }, { status: 400 });
    }
    
    // Start the automated shoutout system
    await startAutomatedShoutouts(serverId);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Automated shoutout system started successfully',
      interval: '10 minutes'
    });
    
  } catch (error) {
    console.error('Start shoutouts error:', error);
    return NextResponse.json({ 
      error: 'Failed to start automated shoutouts',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}