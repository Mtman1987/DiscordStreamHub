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
    motion: { enabled: true, speed: 1, particles: true },
  });

  assert.equal(values.has('--background'), true);
  assert.equal(values.has('--card'), true);
  assert.equal(values.has('--foreground'), true);
  assert.equal(values.has('--accent'), true);
  assert.equal(values.get('--radius'), '0.5rem');
  assert.equal(root.dataset.workspaceTheme, 'oceanic-blue');
  assert.equal(root.dataset.workspaceDensity, 'comfortable');
  assert.equal(root.dataset.workspaceMotion, 'on');
});
