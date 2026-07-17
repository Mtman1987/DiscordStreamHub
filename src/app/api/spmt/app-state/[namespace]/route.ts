import { NextRequest, NextResponse } from 'next/server';
import { DSH_SPMT_COOKIE, SPMT_BASE_URL } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

function namespaceFrom(params: { namespace: string }) {
  const namespace = String(params.namespace || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,49}$/.test(namespace) ? namespace : '';
}

async function forward(request: NextRequest, params: { namespace: string }, method: 'GET' | 'PUT') {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  const namespace = namespaceFrom(params);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!namespace) return NextResponse.json({ error: 'Invalid namespace' }, { status: 400 });
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const ifMatch = request.headers.get('if-match');
  if (ifMatch) headers['If-Match'] = ifMatch;
  let body: string | undefined;
  if (method === 'PUT') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(await request.json().catch(() => ({})));
  }
  const response = await fetch(`${SPMT_BASE_URL}/api/app-state/discord-stream-hub/${namespace}`, { method, headers, body, cache: 'no-store' });
  const payload = await response.json().catch(() => ({ error: 'Invalid SPMT response' }));
  const next = NextResponse.json(payload, { status: response.status });
  const etag = response.headers.get('etag');
  if (etag) next.headers.set('etag', etag);
  return next;
}

export async function GET(request: NextRequest, context: { params: Promise<{ namespace: string }> }) {
  return forward(request, await context.params, 'GET');
}

export async function PUT(request: NextRequest, context: { params: Promise<{ namespace: string }> }) {
  return forward(request, await context.params, 'PUT');
}
