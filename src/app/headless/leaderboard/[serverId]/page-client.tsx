'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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

function LeaderboardComponent({ branding, mode = 'image', cycleSeconds = 0, showSeconds = 20 }: { branding: ServerBranding; mode?: 'image' | 'overlay'; cycleSeconds?: number; showSeconds?: number }) {
  const params = useParams();
  const serverId = params.serverId as string;
  const [leaderboard, setLeaderboard] = useState<FormattedLeaderboardEntry[]>([]);
  const [scheduledVisible, setScheduledVisible] = useState(true);
  const [imageVersion, setImageVersion] = useState(0);

  useEffect(() => {
    if (!cycleSeconds) {
      setScheduledVisible(true);
      return;
    }
    const cycle = Math.max(1, Math.trunc(cycleSeconds));
    const show = Math.min(cycle, Math.max(1, Math.trunc(showSeconds)));
    const update = () => setScheduledVisible((Math.floor(Date.now() / 1000) % cycle) < show);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cycleSeconds, showSeconds]);

  useEffect(() => {
    if (mode !== 'overlay' || !scheduledVisible) return;
    setImageVersion(Date.now());
    const timer = window.setInterval(() => setImageVersion(Date.now()), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [mode, scheduledVisible]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/headless/leaderboard/${encodeURIComponent(serverId)}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!cancelled) setLeaderboard(Array.isArray(payload?.entries) ? payload.entries : []);
      } catch {
        if (!cancelled) setLeaderboard([]);
      }
    };
    if (serverId) void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [serverId]);

  if (mode === 'overlay') {
    if (!scheduledVisible) return <main className="h-screen w-screen bg-transparent" aria-hidden="true" />;
    return (
      <main className="h-screen w-screen overflow-hidden bg-transparent">
        {imageVersion > 0 && (
          // The PNG is the same renderer used by the Discord embed pipeline.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/headless/leaderboard/image/${encodeURIComponent(serverId)}?v=${imageVersion}`}
            alt="Community leaderboard"
            className="h-full w-full object-contain"
          />
        )}
      </main>
    );
  }

  // Browser-source image mode must not paint a full-canvas card while the data
  // is loading or empty. Keep the scheduled layer transparent until there is
  // real leaderboard content to display.
  if (!scheduledVisible || leaderboard.length === 0) {
    return <main className="h-screen w-screen bg-transparent" aria-hidden="true" />;
  }

  return (
    <main data-server={branding.serverName} className="leaderboard relative w-[720px] overflow-hidden bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 px-7 py-6 text-white">
      <div className="stars pointer-events-none absolute inset-0 opacity-50" />

      <section className="relative z-10">
        <header className="mb-4 text-center">
          <h1 className="text-4xl font-black tracking-wide text-white">SPACE MOUNTAIN TOP 5</h1>
        </header>

        <div className="mx-auto flex flex-col gap-4">
          {leaderboard.slice(0, 5).map((entry) => (
            <article
              key={`${entry.rank}:${entry.username}`}
              className="leaderboard-entry flex min-h-[118px] items-center justify-between rounded-2xl border-2 border-cyan-300/70 bg-slate-950/90 px-5 py-3 shadow-lg shadow-cyan-500/20"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 text-2xl font-black ${
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
                  width={88}
                  height={88}
                  className="h-[88px] w-[88px] shrink-0 rounded-full border-4 border-cyan-100/70 bg-slate-900 object-cover shadow-lg shadow-cyan-300/20"
                  onError={(event) => {
                    const image = event.currentTarget;
                    if (image.src !== FALLBACK_AVATAR) image.src = FALLBACK_AVATAR;
                  }}
                />

                <div className="min-w-0">
                  <div className="truncate text-4xl font-black tracking-tight text-cyan-50 drop-shadow-lg">{entry.username}</div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-3xl font-black text-yellow-200 drop-shadow-lg">{entry.points.toLocaleString()}</div>
                <div className="text-xl font-extrabold uppercase tracking-wide text-yellow-100">pts</div>
              </div>
            </article>
          ))}
        </div>

      </section>

      <style jsx>{`
        .stars {
          background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20" cy="20" r="1" fill="white" opacity="0.8"/><circle cx="80" cy="30" r="0.5" fill="white" opacity="0.6"/><circle cx="60" cy="70" r="1" fill="white" opacity="0.7"/><circle cx="30" cy="80" r="0.5" fill="white" opacity="0.5"/><circle cx="10" cy="50" r="0.8" fill="white" opacity="0.9"/><circle cx="90" cy="60" r="0.6" fill="white" opacity="0.7"/></svg>') repeat;
        }
      `}</style>
    </main>
  );
}

export default function HeadlessLeaderboardClientPage({
  branding,
  mode = 'image',
  cycleSeconds = 0,
  showSeconds = 20,
}: {
  branding: ServerBranding;
  mode?: 'image' | 'overlay';
  cycleSeconds?: number;
  showSeconds?: number;
}) {
  return <LeaderboardComponent branding={branding} mode={mode} cycleSeconds={cycleSeconds} showSeconds={showSeconds} />;
}
