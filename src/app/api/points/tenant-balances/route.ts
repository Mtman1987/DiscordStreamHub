import { NextRequest, NextResponse } from 'next/server';
import { getTenantPointBalances } from '@/lib/cross-tenant-service';
import { getServiceToServiceSecrets, hasAuthorizedBearerToken } from '@/lib/runtime-secrets';

export async function POST(request: NextRequest) {
  if (!hasAuthorizedBearerToken(request.headers.get('authorization'), getServiceToServiceSecrets())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body?.userId || '').trim();
  const serverId = String(body?.serverId || '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const tenants = await getTenantPointBalances(userId, serverId);
  return NextResponse.json({
    tenants,
    totalCurrentPoints: tenants.reduce((total, entry) => total + entry.currentPoints, 0),
    totalLifetimePoints: tenants.reduce((total, entry) => total + entry.lifetimePoints, 0),
  });
}
