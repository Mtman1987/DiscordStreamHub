import { NextRequest, NextResponse } from 'next/server';
import { submitCaptainLog } from '@/lib/calendar-admin-actions';

export async function POST(request: NextRequest) {
  try {
    const { serverId, userId, selectedDate } = await request.json();
    
    const result = await submitCaptainLog({ serverId, userId, selectedDate });
    
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to sign up' }, { status: result.statusCode || 400 });
    }

    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Captain log signup error:', error);
    return NextResponse.json({ error: 'Failed to sign up for captain log' }, { status: 500 });
  }
}
