import { unstable_noStore } from 'next/cache';
import ShoutoutCardClientPage from './page-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function HeadlessShoutoutCardPage() {
  unstable_noStore();
  return <ShoutoutCardClientPage />;
}
