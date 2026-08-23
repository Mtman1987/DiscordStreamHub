import { NextResponse } from 'next/server';
import { missingProductionServiceSecrets } from '@/lib/runtime-secrets';

export async function GET() {
  const missingSecrets = missingProductionServiceSecrets();
  return NextResponse.json({
    status: missingSecrets.length ? 'not-ready' : 'ok',
    timestamp: new Date().toISOString(),
    service: 'discord-stream-hub',
    manifestVersion: 'spmt.app-manifest/v1',
    manifestUrl: '/api/platform/manifest',
    buildSha: process.env.BUILD_SHA || 'development',
    startupServicesDisabled: process.env.DISABLE_STARTUP_SERVICES === 'true',
    dependencies: {
      serviceCredentials: missingSecrets.length
        ? { status: 'unavailable', missingSecretNames: missingSecrets }
        : { status: 'configured' },
    },
  }, { status: missingSecrets.length ? 503 : 200 });
}
