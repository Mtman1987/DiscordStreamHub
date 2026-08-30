import SignalRemoveClient from './signal-remove-client';

export const dynamic = 'force-dynamic';

export default async function RemoveSignalPage({
  searchParams,
}: {
  searchParams: Promise<{ k?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawToken = Array.isArray(params.k) ? params.k[0] : params.k;
  const controlToken = String(rawToken || '').trim();
  return <SignalRemoveClient controlToken={controlToken} />;
}
