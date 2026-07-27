'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { Paintbrush, RotateCcw } from 'lucide-react';
import { useIsClient } from '@/hooks/use-is-client';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useSpmtAppState } from '@/hooks/use-spmt-app-state';
import type { WorkspaceThemeTokensV1 } from '@spmt/sdk';
import { applyWorkspaceThemeTokens, clearWorkspaceThemeTokens } from '@/lib/workspace-theme';

// Define the structure for theme settings
interface ThemeSettings {
  primaryHue: number;
  backgroundHue: number;
  backgroundSaturation: number;
  accentHue: number;
  cardHue: number;
  cardAlpha: number;
  sidebarOpacity: number;
  radius: number; // 0 to 1 range for rem
}

// Default values for the theme
const defaultSettings: ThemeSettings = {
  primaryHue: 270,
  backgroundHue: 259,
  backgroundSaturation: 100,
  accentHue: 181,
  cardHue: 259,
  cardAlpha: 1,
  sidebarOpacity: 90,
  radius: 0.5,
};

export function UISettingsCard() {
  const isClient = useIsClient();
  const { theme, setTheme } = useTheme();
  const persisted = useSpmtAppState('ui-preferences', { themeSettings: defaultSettings, followWorkspaceTheme: true, colorMode: 'dark' });

  const [settings, setSettings] = React.useState<ThemeSettings>(defaultSettings);
  const [followWorkspaceTheme, setFollowWorkspaceTheme] = React.useState(true);
  const [workspaceTokens, setWorkspaceTokens] = React.useState<WorkspaceThemeTokensV1 | null>(null);
  const [workspaceThemeError, setWorkspaceThemeError] = React.useState('');

  const loadWorkspaceTheme = React.useCallback(async () => {
    setWorkspaceThemeError('');
    const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.tokens) {
      setWorkspaceTokens(null);
      setWorkspaceThemeError(data.error || 'SpaceMountain theme unavailable');
      return;
    }
    setWorkspaceTokens(data.tokens);
  }, []);

  React.useEffect(() => {
    if (persisted.loaded && followWorkspaceTheme) void loadWorkspaceTheme();
  }, [persisted.loaded, followWorkspaceTheme, loadWorkspaceTheme]);

  React.useEffect(() => {
    if (!persisted.loaded) return;
    setSettings({ ...defaultSettings, ...(persisted.value.themeSettings || {}) });
    setFollowWorkspaceTheme(persisted.value.followWorkspaceTheme !== false);
    setTheme(persisted.value.colorMode === 'light' ? 'light' : 'dark');
    if (persisted.accountBacked) localStorage.removeItem('themeSettings');
  }, [persisted.loaded]);

  // Apply account-backed settings; device-local storage is only cleaned up as a migration.
  React.useEffect(() => {
    if (isClient && followWorkspaceTheme && workspaceTokens) {
      applyWorkspaceThemeTokens(document.documentElement, workspaceTokens);
      return;
    }
    if (isClient && !followWorkspaceTheme) {
      const root = document.documentElement;
      clearWorkspaceThemeTokens(root);
      root.style.setProperty('--primary-hue', settings.primaryHue.toString());
      root.style.setProperty('--background-hue', settings.backgroundHue.toString());
      root.style.setProperty('--background-saturation', `${settings.backgroundSaturation}%`);
      root.style.setProperty('--accent-hue', settings.accentHue.toString());
      root.style.setProperty('--card-hue', settings.cardHue.toString());
      root.style.setProperty('--card-alpha', settings.cardAlpha.toString());
      root.style.setProperty('--sidebar-bg-opacity', (settings.sidebarOpacity / 100).toString());
      root.style.setProperty('--radius', `${settings.radius}rem`);
      
    }
  }, [settings, isClient, theme, followWorkspaceTheme, workspaceTokens]);

  React.useEffect(() => {
    if (!persisted.loaded) return;
    const timer = window.setTimeout(() => {
      void persisted.save({ themeSettings: settings, followWorkspaceTheme, colorMode: theme === 'light' ? 'light' : 'dark' }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [settings, followWorkspaceTheme, theme, persisted.loaded]);
  
  if (!isClient) {
    return (
        <Card>
             <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                <Paintbrush className="text-primary" /> UI Theme Settings
                </CardTitle>
                <CardDescription>
                Customize the look and feel of your application. Changes are saved to your SPMT account.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <p>Loading UI settings...</p>
            </CardContent>
        </Card>
    );
  }

  const handleSliderChange = (key: keyof ThemeSettings) => (value: number[]) => {
    setSettings(prev => ({ ...prev, [key]: value[0] }));
  };

  const resetSettings = () => {
    const root = document.documentElement;
    const isDark = theme === 'dark';
    
    // Set JS state
    setSettings(defaultSettings);

    // Manually reset card lightness/saturation which depends on theme
    root.style.setProperty('--card-saturation', isDark ? '10%' : '100%');
    root.style.setProperty('--card-lightness', isDark ? '12%' : '98%');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <Paintbrush className="text-primary" /> UI Theme Settings
        </CardTitle>
        <CardDescription>
          Customize the look and feel of your application. Changes follow your SPMT account across devices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor="dark-mode" className="font-medium">Dark Mode</Label>
          <Switch
            id="dark-mode"
            checked={theme === 'dark'}
            onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor="follow-workspace-theme" className="font-medium">Follow SpaceMountain theme</Label>
          <Switch id="follow-workspace-theme" checked={followWorkspaceTheme} onCheckedChange={setFollowWorkspaceTheme} />
        </div>
        {followWorkspaceTheme && workspaceTokens && (
          <p className="text-xs text-muted-foreground">Using SpaceMountain theme: {workspaceTokens.themeId}</p>
        )}
        {followWorkspaceTheme && workspaceThemeError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 p-3 text-sm text-destructive">
            <span>{workspaceThemeError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadWorkspaceTheme()}>Retry</Button>
          </div>
        )}

        <Separator />

        <h3 className="text-sm font-medium text-muted-foreground">Colors</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="primary-hue">Primary Color Hue</Label>
            <Slider
              id="primary-hue"
              min={0}
              max={360}
              step={1}
              value={[settings.primaryHue]}
              onValueChange={handleSliderChange('primaryHue')}
            />
            <div className="w-full h-8 rounded-md" style={{ backgroundColor: `hsl(${settings.primaryHue}, 100%, 50%)` }} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="background-hue">Background Hue</Label>
            <Slider
              id="background-hue"
              min={0}
              max={360}
              step={1}
              value={[settings.backgroundHue]}
              onValueChange={handleSliderChange('backgroundHue')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="background-saturation">Background Saturation</Label>
            <Slider
              id="background-saturation"
              min={0}
              max={100}
              step={1}
              value={[settings.backgroundSaturation]}
              onValueChange={handleSliderChange('backgroundSaturation')}
            />
             <div className="w-full h-8 rounded-md border" style={{ backgroundColor: `hsl(${settings.backgroundHue}, ${settings.backgroundSaturation}%, 95%)` }} />
          </div>

           <div className="space-y-2">
            <Label htmlFor="accent-hue">Accent Color Hue</Label>
            <Slider
              id="accent-hue"
              min={0}
              max={360}
              step={1}
              value={[settings.accentHue]}
              onValueChange={handleSliderChange('accentHue')}
            />
            <div className="w-full h-8 rounded-md" style={{ backgroundColor: `hsl(${settings.accentHue}, 100%, 74%)` }} />
          </div>

           <div className="space-y-2">
            <Label htmlFor="card-hue">Card Color Hue</Label>
            <Slider
              id="card-hue"
              min={0}
              max={360}
              step={1}
              value={[settings.cardHue]}
              onValueChange={handleSliderChange('cardHue')}
            />
             <div className="w-full h-8 rounded-md border" style={{ backgroundColor: `hsl(${settings.cardHue}, ${theme === 'dark' ? '10%' : '100%'}, ${theme === 'dark' ? '12%' : '98%'})` }} />
          </div>

           <div className="space-y-2">
            <Label htmlFor="card-alpha">Card Opacity</Label>
            <Slider
              id="card-alpha"
              min={0}
              max={1}
              step={0.05}
              value={[settings.cardAlpha]}
              onValueChange={handleSliderChange('cardAlpha')}
            />
          </div>
        </div>

        <Separator />
        <h3 className="text-sm font-medium text-muted-foreground">Layout</h3>
         <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="radius">Corner Radius</Label>
              <Slider
                id="radius"
                min={0}
                max={1}
                step={0.1}
                value={[settings.radius]}
                onValueChange={handleSliderChange('radius')}
              />
              <div className="w-full h-8 rounded-md border-2 border-dashed bg-muted flex items-center justify-center text-sm" style={{ borderRadius: `${settings.radius}rem` }}>
                Preview
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sidebar-opacity">Sidebar Opacity</Label>
              <Slider
                id="sidebar-opacity"
                min={10}
                max={100}
                step={5}
                value={[settings.sidebarOpacity]}
                onValueChange={handleSliderChange('sidebarOpacity')}
              />
            </div>
         </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={resetSettings} className="w-full">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to Defaults
        </Button>
      </CardFooter>
    </Card>
  );
}
