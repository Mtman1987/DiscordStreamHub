import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import './workspace-parity.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/theme-provider';
import { DataComponentsProvider } from '@/data';
import { SpmtWorkspaceHost } from '@/components/spmt-workspace-host';
import { PersonalOverlayHost } from '@/components/personal-overlay-host';

export const metadata: Metadata = {
  title: 'Discord Stream Hub',
  description: 'Auth hub, shoutout bot, admin support, and community tools.',
  manifest: '/manifest.json',
  icons: {
    icon: '/brand/discord-stream-hub-icon-192.png',
    apple: '/brand/discord-stream-hub-icon-192.png',
    shortcut: '/favicon.ico',
  },
};

export const viewport = {
  themeColor: '#667eea',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn('min-h-screen bg-background font-body antialiased')}>
        <div className="star-field"></div>
        <div className="star-field-2"></div>
        <div className="star-field-3"></div>
        <Script src="https://spmt.live/shared/ecosystem-header.js" data-app="discord-stream-hub" strategy="afterInteractive" />
        <Script src="https://spmt.live/shared/workspace-controller.js" strategy="afterInteractive" />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <DataComponentsProvider>
            {children}
            <PersonalOverlayHost />
            <SpmtWorkspaceHost />
          </DataComponentsProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
