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

  // Initialize state with values from localStorage or defaults
  const [settings, setSettings] = React.useState<ThemeSettings>(() => {
    if (isClient) {
      const savedSettings = localStorage.getItem('themeSettings');
      return savedSettings ? JSON.parse(savedSettings) : defaultSettings;
    }
    return defaultSettings;
  });

  // Effect to apply CSS variables and save to localStorage whenever settings change
  React.useEffect(() => {
    if (isClient) {
      const root = document.documentElement;
      root.style.setProperty('--primary-hue', settings.primaryHue.toString());
      root.style.setProperty('--background-hue', settings.backgroundHue.toString());
      root.style.setProperty('--background-saturation', `${settings.backgroundSaturation}%`);
      root.style.setProperty('--accent-hue', settings.accentHue.toString());
      root.style.setProperty('--card-hue', settings.cardHue.toString());
      root.style.setProperty('--card-alpha', settings.cardAlpha.toString());
      root.style.setProperty('--sidebar-bg-opacity', (settings.sidebarOpacity / 100).toString());
      root.style.setProperty('--radius', `${settings.radius}rem`);
      
      localStorage.setItem('themeSettings', JSON.stringify(settings));
    }
  }, [settings, isClient, theme]);
  
  if (!isClient) {
    return (
        <Card>
             <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                <Paintbrush className="text-primary" /> UI Theme Settings
                </CardTitle>
                <CardDescription>
                Customize the look and feel of your application. Changes are saved locally.
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
          Customize the look and feel of your application. Changes are saved locally.
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
