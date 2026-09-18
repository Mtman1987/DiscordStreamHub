'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function LeaderboardEmbedPage() {
  const params = useParams<{ serverId: string }>();
  const serverId = String(params.serverId || '');
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!serverId) return;
    setSrc(`/api/headless/leaderboard/image/${encodeURIComponent(serverId)}?v=${Date.now()}`);
  }, [serverId]);

  return (
    <main className="h-screen w-screen overflow-hidden bg-transparent" aria-label="Community leaderboard">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Community leaderboard"
          className="block h-full w-full object-contain"
          onError={() => setSrc('')}
        />
      )}
    </main>
  );
}

