import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    startupServicesDisabled: process.env.DISABLE_STARTUP_SERVICES === 'true',
  });
}
