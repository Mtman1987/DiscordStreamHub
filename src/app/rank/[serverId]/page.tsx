import { unstable_noStore } from 'next/cache';
import RankClientPage from './page-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RankPage({
  params,
}: {
  params: { serverId: string };
}) {
  unstable_noStore();
  return <RankClientPage params={params} />;
}
