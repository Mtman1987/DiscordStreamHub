import { NextRequest, NextResponse } from 'next/server';
import { setServerConfig } from '@/lib/config-service';

export async function POST(request: NextRequest) {
  try {
    const { serverId, token } = await request.json();
    
    if (!serverId || !token) {
      return NextResponse.json({ error: 'Server ID and token required' }, { status: 400 });
    }
    
    await setServerConfig(serverId, 'DISCORD_BOT_TOKEN', token);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save token' }, { status: 500 });
  }
}