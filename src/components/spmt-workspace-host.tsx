'use client';

import * as React from 'react';
import { ExternalLink, LayoutGrid, PanelsTopLeft, RefreshCw, Settings, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { WorkspaceDockSlotV1, WorkspaceThemeTokensV1 } from '@spmt/sdk';

const SPMT_ORIGIN = 'https://spmt.live';
const PERSONAL_VISIBILITY_PREFIX = 'discord-stream-hub:personal-overlay-visible';
const PERSONAL_VISIBILITY_EVENT = 'spmt:personal-overlay-visibility';
const PERSONAL_OPACITY_PREFIX = 'discord-stream-hub:personal-overlay-opacity';
const PERSONAL_SCENE_SELECTOR = '[data-personal-overlay-scene="true"]';

type TenantOutputs = { public?: string; personal?: string };
type SurfaceUrls = { worktray?: string; overlays?: string; settings?: string };
type SurfaceId = keyof SurfaceUrls;
type PanelTarget = { kind: 'slot'; id: number } | { kind: 'surface'; id: SurfaceId };
type WorkspaceAppDetail = { appId?: string; title?: string; url?: string; popoutUrl?: string };

const SURFACE_CONTROLS = [
  { id: 'worktray' as const, label: 'Workspace', Icon: LayoutGrid },
  { id: 'overlays' as const, label: 'Overlay Bay', Icon: PanelsTopLeft },
  { id: 'settings' as const, label: 'Settings', Icon: Settings },
];

function fallbackSlots(): WorkspaceDockSlotV1[] {
  return ([1, 2, 3] as const).map((id) => ({ id, title: `Slot ${id}`, url: '', collapsed: true, volume: 1, muted: false }));
}

function clampOpacity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 100;
}

function tenantLocalKey(prefix: string, tenant: string) {
  return `${prefix}:${tenant.trim().toLowerCase()}`;
}

export function SpmtWorkspaceHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname) || pathname.startsWith('/overlay/');
  const [embedded, setEmbedded] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [tokens, setTokens] = React.useState<WorkspaceThemeTokensV1 | null>(null);
  const [target, setTarget] = React.useState<PanelTarget>({ kind: 'surface', id: 'worktray' });
  const [tenant, setTenant] = React.useState('');
  const [tenantOutputs, setTenantOutputs] = React.useState<TenantOutputs | null>(null);
  const [surfaceUrls, setSurfaceUrls] = React.useState<SurfaceUrls>({});
  const [personalOverlayVisible, setPersonalOverlayVisible] = React.useState(true);
  const [personalOpacity, setPersonalOpacity] = React.useState(100);

  const reconnectHref = `/login?next=${encodeURIComponent(pathname || '/dashboard')}`;

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setConnected(false); setTokens(null); setTenant(''); setTenantOutputs(null); setSurfaceUrls({}); setLoaded(true); return;
      }
      const body = await response.json().catch(() => ({}));
      if (!body?.tokens) {
        setConnected(false); setTokens(null); setTenant(''); setTenantOutputs(null); setSurfaceUrls({}); setLoaded(true); return;
      }
      setTokens(body.tokens as WorkspaceThemeTokensV1);
      setTenant(typeof body?.tenant === 'string' ? body.tenant.trim().toLowerCase() : '');
      setTenantOutputs(body?.tenantOutputs && typeof body.tenantOutputs === 'object' ? body.tenantOutputs as TenantOutputs : null);
      setSurfaceUrls(body?.surfaceUrls && typeof body.surfaceUrls === 'object' ? body.surfaceUrls as SurfaceUrls : {});
      setConnected(true); setLoaded(true);
    } catch {
      setConnected(false); setTokens(null); setTenant(''); setTenantOutputs(null); setSurfaceUrls({}); setLoaded(true);
    }
  }, [hiddenRoute]);

  React.useEffect(() => {
    setEmbedded(window.self !== window.top);
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!tenant) return;
    const visible = window.localStorage.getItem(tenantLocalKey(PERSONAL_VISIBILITY_PREFIX, tenant)) !== '0';
    const opacity = clampOpacity(window.localStorage.getItem(tenantLocalKey(PERSONAL_OPACITY_PREFIX, tenant)) ?? 100);
    setPersonalOverlayVisible(visible);
    setPersonalOpacity(opacity);
    window.dispatchEvent(new CustomEvent(PERSONAL_VISIBILITY_EVENT, { detail: { visible, tenant } }));
  }, [tenant]);

  React.useEffect(() => {
    const applyOpacity = () => {
      const factor = personalOpacity / 100;
      document.querySelectorAll<HTMLElement>(PERSONAL_SCENE_SELECTOR).forEach((scene) => {
        scene.dataset.localPersonalOpacity = String(personalOpacity);
        scene.style.opacity = String(factor);
        scene.style.setProperty('background', 'transparent', 'important');
        scene.style.setProperty('background-color', 'transparent', 'important');
      });
    };
    applyOpacity();
    const observer = new MutationObserver(applyOpacity);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [personalOpacity]);

  React.useEffect(() => {
    if (hiddenRoute) return;
    const onFocus = () => void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); };
  }, [hiddenRoute, refresh]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SPMT_ORIGIN || event.data?.type !== 'spmt.surface.updated') return;
      void refresh();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  React.useEffect(() => {
    if (hiddenRoute || embedded) return;
    const onToggle = (event: Event) => {
      event.preventDefault();
      if (open) setOpen(false);
      else { setTarget({ kind: 'surface', id: 'worktray' }); setOpen(true); }
    };
    const onOpenApp = async (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceAppDetail>;
      const url = String(customEvent.detail?.url || '').trim();
      if (!url) return;
      customEvent.preventDefault();
      const currentSlots = tokens?.dockSlots?.length ? tokens.dockSlots : fallbackSlots();
      const existing = currentSlots.find((slot) => String(slot.url || '').trim().toLowerCase() === url.toLowerCase());
      const targetSlot = existing || currentSlots.find((slot) => slot.collapsed || !String(slot.url || '').trim()) || (target.kind === 'slot' ? currentSlots.find((slot) => slot.id === target.id) : null) || currentSlots[0];
      if (!targetSlot) return;
      setTarget({ kind: 'slot', id: targetSlot.id });
      setOpen(true);
      try {
        const response = await fetch('/api/spmt/workspace-theme', {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: customEvent.detail?.appId, title: customEvent.detail?.title, url, slotId: targetSlot.id }),
        });
        if (response.ok) await refresh();
      } catch {}
    };
    window.addEventListener('spmt:workspace-toggle', onToggle);
    window.addEventListener('spmt:workspace-open-app', onOpenApp);
    return () => {
      window.removeEventListener('spmt:workspace-toggle', onToggle);
      window.removeEventListener('spmt:workspace-open-app', onOpenApp);
    };
  }, [embedded, hiddenRoute, open, refresh, target, tokens]);

  React.useEffect(() => {
    if (hiddenRoute || embedded) return;
    window.dispatchEvent(new CustomEvent('spmt:workspace-state', { detail: { open } }));
  }, [embedded, hiddenRoute, open]);

  if (hiddenRoute || embedded) return null;

  const traySlots = tokens?.dockSlots?.length ? tokens.dockSlots : fallbackSlots();
  const activeSlot = target.kind === 'slot' ? traySlots.find((slot) => slot.id === target.id) || null : null;
  const panelUrl = target.kind === 'slot' ? String(activeSlot?.url || '').trim() : String(surfaceUrls[target.id] || '').trim();
  const panelTitle = target.kind === 'slot' ? (activeSlot?.title || `Slot ${target.id}`) : (SURFACE_CONTROLS.find((item) => item.id === target.id)?.label || 'Workspace');
  const popoutUrl = target.kind === 'slot' ? panelUrl : String(surfaceUrls[target.id] || '').trim();

  const openSurface = (id: SurfaceId) => { setTarget({ kind: 'surface', id }); setOpen(true); };
  const togglePersonalOverlay = () => {
    if (!tenant) return;
    const next = !personalOverlayVisible;
    window.localStorage.setItem(tenantLocalKey(PERSONAL_VISIBILITY_PREFIX, tenant), next ? '1' : '0');
    setPersonalOverlayVisible(next);
    window.dispatchEvent(new CustomEvent(PERSONAL_VISIBILITY_EVENT, { detail: { visible: next, tenant } }));
  };
  const changePersonalOpacity = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!tenant) return;
    const next = clampOpacity(event.target.value);
    setPersonalOpacity(next);
    window.localStorage.setItem(tenantLocalKey(PERSONAL_OPACITY_PREFIX, tenant), String(next));
  };
  const copyOutput = (url?: string) => {
    if (!url) return;
    const pending = navigator.clipboard?.writeText(url);
    if (pending) void pending.catch(() => undefined);
  };

  if (!open) return null;

  return <section className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex h-[min(72vh,700px)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/90 shadow-2xl backdrop-blur-xl sm:inset-x-6">
    <header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {connected ? <>
          {traySlots.map((slot) => <button key={slot.id} type="button" onClick={() => setTarget({ kind: 'slot', id: slot.id })} className={`rounded-lg px-3 py-2 text-sm font-medium ${target.kind === 'slot' && target.id === slot.id ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>{slot.title || `Slot ${slot.id}`}</button>)}
          {SURFACE_CONTROLS.map(({ id, label }) => <button key={id} type="button" disabled={!surfaceUrls[id]} onClick={() => setTarget({ kind: 'surface', id })} className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-30 ${target.kind === 'surface' && target.id === id ? 'bg-cyan-300/15 text-cyan-100' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>{label}</button>)}
        </> : <span className="px-2 text-xs font-semibold text-amber-200">SPMT workspace disconnected</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-l border-white/10 pl-2">
        {connected && tenant ? <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5" data-local-personal-controls="true" data-tenant={tenant}>
          <button type="button" onClick={togglePersonalOverlay} className={`rounded-md px-2 py-1 text-xs font-bold ${personalOverlayVisible ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/5 text-white/55'}`} aria-pressed={personalOverlayVisible}>Personal {personalOverlayVisible ? 'On' : 'Off'}</button>
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-white/70"><span>{personalOpacity}%</span><input type="range" min="0" max="100" step="5" value={personalOpacity} onChange={changePersonalOpacity} aria-label="Local Personal overlay opacity" className="w-20 accent-cyan-300" /></label>
        </div> : null}
        {tenantOutputs?.public ? <button type="button" onClick={() => copyOutput(tenantOutputs.public)} className="rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white">Copy Public URL</button> : null}
        {tenantOutputs?.personal ? <button type="button" onClick={() => copyOutput(tenantOutputs.personal)} className="rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white">Copy Personal URL</button> : null}
        {SURFACE_CONTROLS.slice(1).map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => openSurface(id)} disabled={!surfaceUrls[id]} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-30"><Icon className="h-4 w-4" aria-hidden /><span className="hidden md:inline">{label}</span></button>)}
        {popoutUrl ? <a href={popoutUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 no-underline hover:bg-white/10 hover:text-white"><ExternalLink className="h-4 w-4" aria-hidden /><span className="hidden md:inline">Pop out</span></a> : null}
        <button type="button" onClick={() => setOpen(false)} className="inline-flex items-center rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Collapse workspace into ecosystem header"><X className="h-4 w-4" aria-hidden /></button>
      </div>
    </header>

    {!loaded ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-white/70"><RefreshCw className="h-7 w-7 animate-spin" aria-hidden /><p className="text-sm">Connecting to your SPMT workspace…</p></div>
      : !connected ? <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-white/75"><LayoutGrid className="h-9 w-9 text-amber-300" aria-hidden /><div><p className="font-semibold text-white">Discord Stream Hub is open, but the shared SPMT workspace is not connected.</p><p className="mt-1 max-w-lg text-sm text-white/55">Reconnect SPMT once to restore your Workspace.</p></div><a href={reconnectHref} className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-200">Reconnect SPMT workspace</a></div>
        : panelUrl ? <iframe key={`${target.kind}:${String(target.id)}:${panelUrl}`} src={panelUrl} title={panelTitle} className="min-h-0 flex-1 border-0 bg-transparent" allow="autoplay; microphone; camera; fullscreen; clipboard-write" />
          : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-white/70"><LayoutGrid className="h-8 w-8" aria-hidden /><p className="text-sm">{target.kind === 'slot' ? 'This workspace slot has no URL assigned yet.' : 'That canonical SPMT surface is currently unavailable.'}</p><button type="button" onClick={() => openSurface('worktray')} className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">Open canonical Workspace</button></div>}
  </section>;
}
