'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

const PERSONAL_VISIBILITY_PREFIX = 'discord-stream-hub:personal-overlay-visible';
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
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  letterSpacing?: number;
  lineHeight?: number;
  backgroundEnabled?: boolean;
  backgroundColor?: string;
  textShadow?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string;
};

type PersonalLayout = {
  enabled?: boolean;
  widgets?: PersonalWidget[];
};

type SceneFrame = {
  left: number;
  top: number;
  scale: number;
};

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tenantVisibilityKey(tenant: string) {
  return `${PERSONAL_VISIBILITY_PREFIX}:${tenant.trim().toLowerCase()}`;
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
    return <div className="grid h-full w-full items-center whitespace-pre-wrap p-3" style={{
      color: widget.color || '#fff',
      fontSize: `${Math.max(8, number(widget.fontSize, 42))}px`,
      fontFamily: widget.fontFamily || 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontWeight: widget.fontWeight || 900,
      fontStyle: widget.fontStyle === 'italic' ? 'italic' : 'normal',
      textDecoration: widget.textDecoration === 'underline' ? 'underline' : 'none',
      letterSpacing: `${number(widget.letterSpacing, 0)}px`,
      lineHeight: Math.max(0.7, Math.min(3, number(widget.lineHeight, 1.05))),
      textAlign: align,
      justifyItems: align === 'left' ? 'start' : align === 'right' ? 'end' : 'center',
      background: widget.backgroundEnabled ? (widget.backgroundColor || '#000000') : 'transparent',
      textShadow: widget.textShadow === false ? 'none' : '0 3px 18px rgba(0,0,0,.8)',
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
  const [tenant, setTenant] = React.useState('');
  const [visible, setVisible] = React.useState(true);
  const [layout, setLayout] = React.useState<PersonalLayout | null>(null);
  const [frame, setFrame] = React.useState<SceneFrame>({ left: 0, top: 0, scale: 1 });
  const stageRef = React.useRef<HTMLDivElement | null>(null);

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/personal-overlay', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setTenant('');
        setLayout(null);
        return;
      }
      const body = await response.json().catch(() => ({}));
      const nextTenant = typeof body?.tenant === 'string' ? body.tenant.trim().toLowerCase() : '';
      setTenant(nextTenant);
      if (nextTenant) setVisible(window.localStorage.getItem(tenantVisibilityKey(nextTenant)) !== '0');
      setLayout(body?.layout && typeof body.layout === 'object' ? body.layout as PersonalLayout : null);
    } catch {
      setTenant('');
      setLayout(null);
    }
  }, [hiddenRoute]);

  React.useEffect(() => {
    const isEmbedded = window.self !== window.top;
    setEmbedded(isEmbedded);
    if (!isEmbedded) void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const resizeScene = () => {
      const width = stage.clientWidth || SCENE_WIDTH;
      const height = stage.clientHeight || SCENE_HEIGHT;
      const scale = Math.min(width / SCENE_WIDTH, height / SCENE_HEIGHT);
      setFrame({
        left: (width - SCENE_WIDTH * scale) / 2,
        top: (height - SCENE_HEIGHT * scale) / 2,
        scale,
      });
    };

    resizeScene();
    const observer = new ResizeObserver(resizeScene);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [layout]);

  React.useEffect(() => {
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ visible?: boolean; tenant?: string }>).detail;
      if (detail?.tenant && tenant && detail.tenant !== tenant) return;
      if (typeof detail?.visible === 'boolean') setVisible(detail.visible);
    };
    window.addEventListener(PERSONAL_VISIBILITY_EVENT, onVisibility);
    return () => window.removeEventListener(PERSONAL_VISIBILITY_EVENT, onVisibility);
  }, [tenant]);

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

  if (embedded || hiddenRoute || !tenant || !visible || !layout || layout.enabled === false) return null;

  const widgets = Array.isArray(layout.widgets) ? layout.widgets.filter((widget) => widget?.visible !== false) : [];

  return <div
    ref={stageRef}
    aria-label="Canonical SPMT Personal overlay"
    aria-hidden="true"
    data-canonical-personal-overlay="true"
    data-personal-overlay-stage="true"
    data-tenant={tenant}
    className="pointer-events-none fixed inset-0 z-[90] overflow-hidden bg-transparent"
    style={{ background: 'transparent' }}
  >
    <div
      data-personal-overlay-scene="true"
      className="pointer-events-none absolute left-0 top-0 bg-transparent"
      style={{
        width: `${SCENE_WIDTH}px`,
        height: `${SCENE_HEIGHT}px`,
        transform: `translate3d(${frame.left}px, ${frame.top}px, 0) scale(${frame.scale})`,
        transformOrigin: '0 0',
        background: 'transparent',
      }}
    >
      {widgets.map((widget, index) => <section key={widget.id || `${widget.kind || 'widget'}-${index}`} style={widgetStyle(widget)}>
        <PersonalAsset widget={widget} />
      </section>)}
    </div>
  </div>;
}
