'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { DataComponentsProvider, useCollection, useDataStore } from '@/data';
import { collection, limit, orderBy, query } from '@/lib/data-shim';
import type { LeaderboardEntry, UserProfile } from '@/lib/types';
import type { ServerBranding } from '@/lib/tenant-utils';

const FALLBACK_AVATAR = 'https://spacemountain.live/assets/space-logo-main.png';

interface FormattedLeaderboardEntry {
  username: string;
  points: number;
  rank: number;
  avatarUrl: string;
}

function rankLabel(rank: number): string {
  if (rank === 1) return '1';
  if (rank === 2) return '2';
  if (rank === 3) return '3';
  return `#${rank}`;
}

function LeaderboardComponent({ branding }: { branding: ServerBranding }) {
  const params = useParams();
  const serverId = params.serverId as string;
  const store = useDataStore();
  const [leaderboard, setLeaderboard] = useState<FormattedLeaderboardEntry[]>([]);

  const leaderboardQuery = useMemo(() => {
    if (!store || !serverId) return null;
    return query(collection(store, 'servers', serverId, 'leaderboard'), orderBy('points', 'desc'), limit(10));
  }, [store, serverId]);

  const { data: rawLeaderboard } = useCollection<LeaderboardEntry>(leaderboardQuery);
  const { data: allUsers } = useCollection<UserProfile>(collection(store, 'servers', serverId, 'users'));

  useEffect(() => {
    if (!rawLeaderboard || !allUsers) return;

    const usersById = new Map<string, UserProfile>();
    for (const user of allUsers) {
      usersById.set(String(user.id), user);
      if (user.discordUserId) usersById.set(String(user.discordUserId), user);
    }

    setLeaderboard(rawLeaderboard.map((entry, index) => {
      const user = usersById.get(String(entry.userProfileId));
      return {
        username: user?.username || String(entry.userProfileId),
        points: Number(entry.points || 0),
        rank: index + 1,
        avatarUrl: user?.avatarUrl || FALLBACK_AVATAR,
      };
    }));
  }, [rawLeaderboard, allUsers]);

  return (
    <main className="leaderboard relative w-[1200px] overflow-hidden bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 px-20 py-10 text-white">
      <div className="stars pointer-events-none absolute inset-0 opacity-50" />

      <section className="relative z-10">
        <header className="mb-7 text-center">
          <h1 className="mb-2 text-5xl font-bold">SPACE MOUNTAIN LEADERBOARD</h1>
          <p className="text-xl font-semibold text-yellow-300">TOP {branding.communityMemberNamePlural.toUpperCase()}</p>
        </header>

        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {leaderboard.map((entry) => (
            <article
              key={`${entry.rank}:${entry.username}`}
              className="leaderboard-entry flex min-h-[86px] items-center justify-between rounded-xl border border-blue-300/50 bg-slate-950/80 px-5 py-3 shadow-lg shadow-cyan-500/10"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-2xl font-extrabold ${
                  entry.rank === 1 ? 'border-yellow-300 bg-yellow-400/20 text-yellow-200' :
                  entry.rank === 2 ? 'border-slate-300 bg-slate-300/20 text-slate-100' :
                  entry.rank === 3 ? 'border-orange-300 bg-orange-400/20 text-orange-200' :
                  'border-blue-300/60 bg-blue-400/10 text-blue-200'
                }`}>
                  {rankLabel(entry.rank)}
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.avatarUrl}
                  alt={`${entry.username} avatar`}
                  width={64}
                  height={64}
                  className="h-16 w-16 shrink-0 rounded-full border-2 border-blue-200/40 bg-slate-900 object-cover"
                  onError={(event) => {
                    const image = event.currentTarget;
                    if (image.src !== FALLBACK_AVATAR) image.src = FALLBACK_AVATAR;
                  }}
                />

                <div className="min-w-0">
                  <div className="truncate text-2xl font-bold">{entry.username}</div>
                  <div className="text-lg text-blue-200">{branding.communityMemberName}</div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-3xl font-bold text-yellow-300">{entry.points.toLocaleString()}</div>
                <div className="text-lg text-blue-200">Points</div>
              </div>
            </article>
          ))}
        </div>

        <footer className="mt-7 text-center text-xl text-white">
          Join {branding.serverName} to climb the ranks!
        </footer>
      </section>

      <style jsx>{`
        .stars {
          background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20" cy="20" r="1" fill="white" opacity="0.8"/><circle cx="80" cy="30" r="0.5" fill="white" opacity="0.6"/><circle cx="60" cy="70" r="1" fill="white" opacity="0.7"/><circle cx="30" cy="80" r="0.5" fill="white" opacity="0.5"/><circle cx="10" cy="50" r="0.8" fill="white" opacity="0.9"/><circle cx="90" cy="60" r="0.6" fill="white" opacity="0.7"/></svg>') repeat;
        }
      `}</style>
    </main>
  );
}

export default function HeadlessLeaderboardClientPage({ branding }: { branding: ServerBranding }) {
  return (
    <DataComponentsProvider>
      <LeaderboardComponent branding={branding} />
    </DataComponentsProvider>
  );
}
