import { NextRequest, NextResponse } from 'next/server';
import { generateRaidTrainShoutout } from '@/ai/flows/generate-raid-train-shoutout';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  try {
    if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
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