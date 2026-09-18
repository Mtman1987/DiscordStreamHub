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

  const mediaUrl = String(spotlight?.gifUrl || '').trim();

  if (!spotlight || !mediaUrl) {
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      </main>
    </>
  );
}
