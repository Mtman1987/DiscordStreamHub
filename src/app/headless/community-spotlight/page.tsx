'use client';

import { useEffect, useRef, useState } from 'react';

type SpotlightPayload = {
  twitchLogin?: string | null;
  user?: { twitchLogin?: string | null; username?: string | null } | null;
};

type CommunitySpotlightResponse = {
  spotlight?: SpotlightPayload | null;
};

declare global {
  interface Window {
    Twitch?: any;
  }
}

const TWITCH_SDK = 'https://player.twitch.tv/js/embed/v1.js';

function HeadlessChromeReset() {
  return (
    <style>{`
      html, body { background: transparent !important; }
      .star-field, .star-field-2, .star-field-3 { display: none !important; }
    `}</style>
  );
}

function uniqueParents(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function spotlightLogin(body: CommunitySpotlightResponse) {
  return String(body?.spotlight?.twitchLogin || body?.spotlight?.user?.twitchLogin || '').trim().toLowerCase();
}

export default function CommunitySpotlightHeadlessPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [login, setLogin] = useState('');
  const [sdkReady, setSdkReady] = useState(Boolean(typeof window !== 'undefined' && window.Twitch?.Player));
  const [volume, setVolume] = useState(0.58);
  const [parents, setParents] = useState<string[]>([]);
  const [playerVisible, setPlayerVisible] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setVolume(Math.max(0, Math.min(1, Number(query.get('volume') || 0.58))));
    setParents(uniqueParents([window.location.hostname, ...query.getAll('parent')]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/community-spotlight', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json() as CommunitySpotlightResponse;
        if (!cancelled) setLogin(spotlightLogin(body));
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (window.Twitch?.Player) {
      setSdkReady(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TWITCH_SDK}"]`);
    const script = existing || document.createElement('script');
    const ready = () => setSdkReady(Boolean(window.Twitch?.Player));
    script.addEventListener('load', ready, { once: true });
    if (!existing) {
      script.src = TWITCH_SDK;
      script.async = true;
      document.head.appendChild(script);
    }
    return () => script.removeEventListener('load', ready);
  }, []);

  useEffect(() => {
    try {
      playerRef.current?.destroy?.();
    } catch {}
    playerRef.current = null;
    setPlayerVisible(false);
    if (!sdkReady || !login || !mountRef.current || !window.Twitch?.Player) return;

    mountRef.current.replaceChildren();
    const node = document.createElement('div');
    node.id = `dsh-spotlight-player-${Date.now()}`;
    node.style.width = '100%';
    node.style.height = '100%';
    mountRef.current.appendChild(node);

    const player = new window.Twitch.Player(node.id, {
      channel: login,
      width: '100%',
      height: '100%',
      parent: parents,
      autoplay: true,
      // Start muted so browsers are allowed to begin playback without a user
      // gesture. We attempt to restore program audio only after playback starts.
      muted: true,
    });
    playerRef.current = player;
    const onReady = () => {
      try {
        player.setVolume(volume);
        player.play();
      } catch {}
    };
    const onPlaying = () => {
      setPlayerVisible(true);
      try {
        player.setVolume(volume);
        player.setMuted(false);
      } catch {}
    };
    const onHidden = () => setPlayerVisible(false);

    player.addEventListener(window.Twitch.Player.READY, onReady);
    player.addEventListener(window.Twitch.Player.PLAYING, onPlaying);
    player.addEventListener(window.Twitch.Player.OFFLINE, onHidden);
    if (window.Twitch.Player.PLAYBACK_BLOCKED) {
      player.addEventListener(window.Twitch.Player.PLAYBACK_BLOCKED, onHidden);
    }

    return () => {
      try { player.removeEventListener?.(window.Twitch.Player.READY, onReady); } catch {}
      try { player.removeEventListener?.(window.Twitch.Player.PLAYING, onPlaying); } catch {}
      try { player.removeEventListener?.(window.Twitch.Player.OFFLINE, onHidden); } catch {}
      try {
        if (window.Twitch.Player.PLAYBACK_BLOCKED) {
          player.removeEventListener?.(window.Twitch.Player.PLAYBACK_BLOCKED, onHidden);
        }
      } catch {}
      try { player.destroy?.(); } catch {}
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [login, parents, sdkReady, volume]);

  if (!login) {
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
      <main className="h-screen w-screen overflow-hidden bg-transparent">
        <div
          ref={mountRef}
          className="h-full w-full"
          data-community-spotlight={login}
          style={{ opacity: playerVisible ? 1 : 0, transition: 'opacity 180ms ease' }}
        />
      </main>
    </>
  );
}
