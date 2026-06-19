'use server';

import { db } from '@/lib/db';

type CommunityStats = {
  totalMembers: number;
  liveMembers: number;
};

export async function getCommunityStats(serverId: string): Promise<CommunityStats> {
  const snapshot = await db.collection('servers').doc(serverId).collection('users').get();
  const docs = snapshot.docs.map((doc: { data: () => Record<string, unknown> }) => doc.data());
  const liveMembers = docs.filter((doc: Record<string, unknown>) => doc?.isOnline || doc?.isLive).length;

  return {
    totalMembers: docs.length,
    liveMembers,
  };
}

function buildPlaceholderImage(label: string): string {
  return `https://placehold.co/1200x300/111827/F9FAFB?text=${encodeURIComponent(label)}`;
}

export async function generateSpotlightHeaderImage(
  _serverId: string,
  stats: CommunityStats
): Promise<string> {
  return buildPlaceholderImage(`Community Spotlight • ${stats.liveMembers} Live Now`);
}

export async function generateSpotlightFooterImage(
  _serverId: string,
  stats: CommunityStats
): Promise<string> {
  return buildPlaceholderImage(`Join ${stats.totalMembers} Community Members`);
}
