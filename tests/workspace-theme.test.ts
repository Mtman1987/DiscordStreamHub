import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceThemeTokens, hexToHslComponents } from '../src/lib/workspace-theme';

test('converts shared SDK colors to the HSL components used by DSH', () => {
  assert.equal(hexToHslComponents('#000000'), '0 0% 0%');
  assert.equal(hexToHslComponents('#ffffff'), '0 0% 100%');
  assert.equal(hexToHslComponents('#ff0000'), '0 100% 50%');
});

test('applies every shared workspace token to the DSH CSS contract', () => {
  const values = new Map<string, string>();
  const root = {
    style: { setProperty: (key: string, value: string) => values.set(key, value) },
    dataset: {} as Record<string, string>,
  } as unknown as HTMLElement;

  applyWorkspaceThemeTokens(root, {
    schemaVersion: 1,
    followWorkspace: true,
    themeId: 'oceanic-blue',
    background: '#06111a',
    surface: '#0c2535',
    text: '#effaff',
    accent: '#22d3ee',
    radius: 'md',
    density: 'comfortable',
    motion: { enabled: true, speed: 1, particles: true, shootingStars: true },
    appearance: {
      themeId: 'oceanic-blue',
      glowIntensity: 80,
      starDensity: 70,
      glassOpacity: 65,
      blurStrength: 22,
      nebulaIntensity: 80,
      parallaxDepth: 65,
      borderStrength: 60,
      cornerRadius: 'md',
      density: 'comfortable',
      sidebarCollapsed: false,
      sidebarStyle: 'docked',
      sidebarPosition: 'left',
      topbarStyle: 'transparent',
      tabStyle: 'pills',
      tabPosition: 'top',
      chatTransparency: 65,
      showAvatars: true,
      smoothTransitions: true,
      pushToTalk: true,
      animation: { enabled: true, speed: 85, particles: true, shootingStars: true },
    },
    dockSlots: [
      { id: 1, title: 'ChatTag Overlay', url: 'https://chat-tag-new.fly.dev/overlay', collapsed: true, volume: 1, muted: false },
      { id: 2, title: 'Quackverse Game', url: 'https://spacemountain.live/chat-tag/quackverse', collapsed: false, volume: 1, muted: false },
      { id: 3, title: 'DSH Dashboard', url: 'https://discord-stream-hub-new.fly.dev/dashboard', collapsed: true, volume: 1, muted: false },
    ],
    activeOverlaySceneId: 'main-scene',
    overlayWorkspace: {
      enabled: true,
      widgets: [
        {
          id: 'chat-tag-overlay',
          title: 'ChatTag Overlay',
          kind: 'chat',
          url: 'https://chat-tag-new.fly.dev/overlay',
          visible: true,
          locked: false,
          interactive: false,
          x: 72,
          y: 66,
          width: 360,
          height: 220,
          opacity: 1,
        },
      ],
      workflows: [],
    },
    ttsSubscriptions: ['streamweaver'],
    appThemeMappings: { 'discord-stream-hub': 'follow-workspace' },
  });

  assert.equal(values.has('--background'), true);
  assert.equal(values.has('--card'), true);
  assert.equal(values.has('--foreground'), true);
  assert.equal(values.has('--accent'), true);
  assert.equal(values.get('--radius'), '18px');
  assert.equal(values.get('--workspace-background-image'), 'url("https://spacemountain.live/assets/theme-oceanic-blue-background.webp")');
  assert.equal(root.dataset.workspaceTheme, 'oceanic-blue');
  assert.equal(root.dataset.workspaceDensity, 'comfortable');
  assert.equal(root.dataset.workspaceMotion, 'on');
  assert.equal(values.get('--workspace-glass-opacity'), '0.65');
  assert.equal(root.dataset.workspaceOverlayEnabled, 'true');
  assert.equal((root.dataset.workspaceOverlayWidgets || '').length > 0, true);
  assert.equal((root.dataset.workspaceDockSlots || '').length > 0, true);
});
