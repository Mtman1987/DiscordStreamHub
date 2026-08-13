'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

const SPMT_ORIGIN = 'https://spmt.live';
const PERSONAL_VISIBILITY_KEY = 'discord-stream-hub:personal-overlay-visible';
const PERSONAL_VISIBILITY_EVENT = 'spmt:personal-overlay-visibility';
const PERSONAL_READY_EVENT = 'spmt.personal.renderer-ready';

export function PersonalOverlayHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname)
    || pathname.startsWith('/overlay/')
    || pathname === '/quackverse-overlay';
  const [embedded, setEmbedded] = React.useState(true);
  const [visible, setVisible] = React.useState(true);
  const [url, setUrl] = React.useState('');
  const [ready, setReady] = React.useState(false);
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setReady(false);
        setUrl('');
        return;
      }
      const body = await response.json().catch(() => ({}));
      const nextUrl = typeof body?.personalOverlayUrl === 'string'
        && body.personalOverlayUrl.startsWith(`${SPMT_ORIGIN}/tenant/`)
        && body.personalOverlayUrl.includes('/personal#render=')
        ? body.personalOverlayUrl
        : '';
      setUrl((current) => {
        if (current !== nextUrl) setReady(false);
        return nextUrl;
      });
    } catch {
      setReady(false);
      setUrl('');
    }
  }, [hiddenRoute]);

  React.useEffect(() => {
    const isEmbedded = window.self !== window.top;
    setEmbedded(isEmbedded);
    setVisible(window.localStorage.getItem(PERSONAL_VISIBILITY_KEY) !== '0');
    if (!isEmbedded) void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ visible?: boolean }>).detail;
      if (typeof detail?.visible === 'boolean') setVisible(detail.visible);
    };
    window.addEventListener(PERSONAL_VISIBILITY_EVENT, onVisibility);
    return () => window.removeEventListener(PERSONAL_VISIBILITY_EVENT, onVisibility);
  }, []);

  React.useEffect(() => {
    if (hiddenRoute || embedded) return;
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SPMT_ORIGIN) return;
      if (event.data?.type === 'spmt.surface.updated') void refresh();
      if (event.data?.type === PERSONAL_READY_EVENT && event.source === frameRef.current?.contentWindow) setReady(true);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('message', onMessage);
    };
  }, [embedded, hiddenRoute, refresh]);

  if (embedded || hiddenRoute || !visible || !url) return null;
  return <iframe
    ref={frameRef}
    src={url}
    title="SPMT Personal overlay"
    aria-hidden="true"
    data-canonical-personal-overlay="true"
    data-renderer-ready={ready ? 'true' : 'false'}
    className={`pointer-events-none fixed inset-0 z-[90] h-screen w-screen border-0 bg-transparent ${ready ? 'opacity-100' : 'opacity-0'}`}
    allow="autoplay"
  />;
}
