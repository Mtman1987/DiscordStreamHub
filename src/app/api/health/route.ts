import { NextResponse } from 'next/server';
import { missingProductionServiceSecrets } from '@/lib/runtime-secrets';

export async function GET() {
  const missingSecrets = missingProductionServiceSecrets();
  return NextResponse.json({
    status: missingSecrets.length ? 'not-ready' : 'ok',
    timestamp: new Date().toISOString(),
    startupServicesDisabled: process.env.DISABLE_STARTUP_SERVICES === 'true',
    dependencies: {
      serviceCredentials: missingSecrets.length
        ? { status: 'unavailable', missingSecretNames: missingSecrets }
        : { status: 'configured' },
    },
  }, { status: missingSecrets.length ? 503 : 200 });
}
