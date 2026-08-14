'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

const PERSONAL_VISIBILITY_KEY = 'discord-stream-hub:personal-overlay-visible';
const PERSONAL_VISIBILITY_EVENT = 'spmt:personal-overlay-visibility';
const SCENE_WIDTH = 960;
const SCENE_HEIGHT = 540;

type PersonalWidget = {
  id?: string;
  title?: string;
  kind?: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  zIndex?: number;
  fit?: 'contain' | 'cover' | 'fill';
  url?: string;
  text?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  color?: string;
};

type PersonalLayout = {
  enabled?: boolean;
  widgets?: PersonalWidget[];
};

type LockedViewport = {
  width: number;
  height: number;
};

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentViewport(): LockedViewport {
  return {
    width: Math.max(1, window.innerWidth || SCENE_WIDTH),
    height: Math.max(1, window.innerHeight || SCENE_HEIGHT),
  };
}

function widgetStyle(widget: PersonalWidget): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${number(widget.x, 0)}%`,
    top: `${number(widget.y, 0)}%`,
    width: `${Math.max(0, number(widget.width, 360))}px`,
    height: `${Math.max(0, number(widget.height, 220))}px`,
    opacity: Math.max(0, Math.min(1, number(widget.opacity, 1))),
    zIndex: number(widget.zIndex, 0),
    overflow: 'hidden',
    background: 'transparent',
    pointerEvents: 'none',
  };
}

function PersonalAsset({ widget }: { widget: PersonalWidget }) {
  const fit = widget.fit || 'contain';
  if (widget.kind === 'image' && widget.url) {
    return <img src={widget.url} alt={widget.title || ''} className="block h-full w-full bg-transparent" style={{ objectFit: fit }} />;
  }
  if (widget.kind === 'embed' && widget.url) {
    return <iframe src={widget.url} title={widget.title || 'Personal overlay asset'} className="block h-full w-full border-0 bg-transparent" style={{ background: 'transparent' }} allow="autoplay; microphone; camera; fullscreen; clipboard-write" />;
  }
  if (widget.kind === 'text') {
    const align = widget.align === 'left' || widget.align === 'right' ? widget.align : 'center';
    return <div className="grid h-full w-full items-center whitespace-pre-wrap bg-transparent p-3 font-black leading-tight" style={{
      color: widget.color || '#fff',
      fontSize: `${Math.max(12, number(widget.fontSize, 42))}px`,
      textAlign: align,
      justifyItems: align === 'left' ? 'start' : align === 'right' ? 'end' : 'center',
      textShadow: '0 3px 18px rgba(0,0,0,.8)',
    }}>{widget.text || 'Text'}</div>;
  }
  return null;
}

export function PersonalOverlayHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname)
    || pathname.startsWith('/overlay/')
    || pathname === '/quackverse-overlay';
  const [embedded, setEmbedded] = React.useState(true);
  const [visible, setVisible] = React.useState(true);
  const [layout, setLayout] = React.useState<PersonalLayout | null>(null);
  const [viewport, setViewport] = React.useState<LockedViewport>({ width: SCENE_WIDTH, height: SCENE_HEIGHT });
  const viewportRef = React.useRef<LockedViewport>({ width: SCENE_WIDTH, height: SCENE_HEIGHT });

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/personal-overlay', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setLayout(null);
        return;
      }
      const body = await response.json().catch(() => ({}));
      setLayout(body?.layout && typeof body.layout === 'object' ? body.layout as PersonalLayout : null);
    } catch {
      setLayout(null);
    }
  }, [hiddenRoute]);

  React.useEffect(() => {
    const isEmbedded = window.self !== window.top;
    const initialViewport = currentViewport();
    viewportRef.current = initialViewport;
    setViewport(initialViewport);
    setEmbedded(isEmbedded);
    setVisible(window.localStorage.getItem(PERSONAL_VISIBILITY_KEY) !== '0');

    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const onResize = () => {
      const next = currentViewport();
      const previous = viewportRef.current;
      const widthChanged = Math.abs(next.width - previous.width) > 1;

      // Mobile Chrome changes only innerHeight while its address bar expands and
      // collapses during scrolling. Treat that as browser chrome, not a scene
      // resize, so Personal assets stay locked to the viewport instead of
      // drifting with the scroll and snapping back afterward.
      if (coarsePointer && !widthChanged) return;

      viewportRef.current = next;
      setViewport(next);
    };

    window.addEventListener('resize', onResize, { passive: true });
    if (!isEmbedded) void refresh();
    return () => window.removeEventListener('resize', onResize);
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
    const timer = window.setInterval(() => void refresh(), 5_000);
    const onFocus = () => void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [embedded, hiddenRoute, refresh]);

  if (embedded || hiddenRoute || !visible || !layout || layout.enabled === false) return null;

  const scale = Math.min(viewport.width / SCENE_WIDTH, viewport.height / SCENE_HEIGHT);
  const widgets = Array.isArray(layout.widgets) ? layout.widgets.filter((widget) => widget?.visible !== false) : [];

  return <div
    aria-label="Canonical SPMT Personal overlay"
    aria-hidden="true"
    data-canonical-personal-overlay="true"
    className="pointer-events-none fixed left-0 top-0 z-[90] grid place-items-center overflow-hidden bg-transparent"
    style={{
      width: `${viewport.width}px`,
      height: `${viewport.height}px`,
      background: 'transparent',
      transform: 'translate3d(0,0,0)',
      willChange: 'transform',
      contain: 'layout paint size',
      isolation: 'isolate',
    }}
  >
    <div
      data-personal-overlay-scene="true"
      className="pointer-events-none relative shrink-0 bg-transparent"
      style={{
        width: `${SCENE_WIDTH}px`,
        height: `${SCENE_HEIGHT}px`,
        transform: `translate3d(0,0,0) scale(${scale})`,
        transformOrigin: 'center center',
        background: 'transparent',
        willChange: 'transform',
      }}
    >
      {widgets.map((widget, index) => <section key={widget.id || `${widget.kind || 'widget'}-${index}`} style={widgetStyle(widget)}>
        <PersonalAsset widget={widget} />
      </section>)}
    </div>
  </div>;
}
