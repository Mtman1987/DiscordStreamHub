'use client';

import { useEffect, useState } from 'react';

type SpotlightPayload = {
  twitchLogin?: string | null;
  gifUrl?: string | null;
  avatarUrl?: string | null;
  streamTitle?: string | null;
  gameTitle?: string | null;
  viewerCount?: number | null;
  user?: { twitchLogin?: string | null; username?: string | null } | null;
};

type CommunitySpotlightResponse = {
  spotlight?: SpotlightPayload | null;
};

function HeadlessChromeReset() {
  return (
    <style>{`
      html, body {
        margin: 0 !important;
        width: 100% !important;
        height: 100% !important;
        overflow: hidden !important;
        background: transparent !important;
      }
      .star-field, .star-field-2, .star-field-3 {
        display: none !important;
      }
    `}</style>
  );
}

export default function CommunitySpotlightHeadlessPage() {
  const [spotlight, setSpotlight] = useState<SpotlightPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/community-spotlight', { cache: 'no-store' });
        if (!response.ok) {
          if (!cancelled) setSpotlight(null);
          return;
        }
        const body = await response.json() as CommunitySpotlightResponse;
        if (!cancelled) setSpotlight(body?.spotlight || null);
      } catch {
        if (!cancelled) setSpotlight(null);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const twitchLogin = String(spotlight?.twitchLogin || spotlight?.user?.twitchLogin || '').trim();
  const twitchParent = typeof window !== 'undefined' ? window.location.hostname : 'discord-stream-hub-new.fly.dev';

  if (!spotlight || !twitchLogin) {
    return (
      <>
        <HeadlessChromeReset />
        <main className="h-screen w-screen bg-transparent" aria-hidden="true" />
      </>
    );
  }

  return (
    <>
      <HeadlessChromeReset />
      <main className="relative h-screen w-screen overflow-hidden bg-transparent">
        <iframe
          src={`https://player.twitch.tv/?channel=${encodeURIComponent(twitchLogin)}&parent=${encodeURIComponent(twitchParent)}&autoplay=true&muted=true&controls=false`}
          title={`${twitchLogin} live on Twitch`}
          className="absolute inset-0 h-full w-full border-0 bg-transparent"
          allow="autoplay; fullscreen"
          allowFullScreen
        />
      </main>
    </>
  );
}
