import { NextRequest, NextResponse } from 'next/server';
import { generateRaidTrainShoutout } from '@/ai/flows/generate-raid-train-shoutout';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { forceUsername } = await request.json();
    
    const result = await generateRaidTrainShoutout({ forceUsername });
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('Error generating raid train shoutout:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}