import HeadlessLeaderboardClientPage from './page-client';

export const dynamic = 'force-dynamic';

function firstValue(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim();
}

export default async function HeadlessLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ serverId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ serverId }, query] = await Promise.all([params, searchParams]);

  const mode = firstValue(query.mode) === 'overlay' ? 'overlay' : 'image';
  const cycleSeconds = Math.max(0, Number(firstValue(query.cycle)) || 0);
  const showSeconds = Math.max(1, Number(firstValue(query.show)) || 20);

  return <HeadlessLeaderboardClientPage
    branding={{
      serverName: firstValue(query.serverName) || serverId || 'Space Mountain',
      communityMemberName: firstValue(query.memberName) || 'Mountaineer',
      communityMemberNamePlural: firstValue(query.memberNamePlural) || 'Mountaineers',
    }}
    mode={mode}
    cycleSeconds={cycleSeconds}
    showSeconds={showSeconds}
  />;
}
