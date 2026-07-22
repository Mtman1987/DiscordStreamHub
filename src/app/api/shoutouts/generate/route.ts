import { NextRequest, NextResponse } from 'next/server';
import { generateShoutout } from '@/ai/flows/generate-shoutout';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  try {
    if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username, type } = await request.json();
    
    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const result = await generateShoutout({ username });
    
    return NextResponse.json({
      shoutout: result.shoutout,
      username: username
    });

  } catch (error) {
    console.error('Error generating shoutout:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}