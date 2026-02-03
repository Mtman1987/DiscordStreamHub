import { unstable_noStore } from 'next/cache';
import RaidPileClientPage from './page-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RaidPilePage() {
  unstable_noStore();
  return <RaidPileClientPage />;
}
