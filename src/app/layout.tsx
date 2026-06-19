import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/theme-provider';
import { DataComponentsProvider } from '@/data';

export const metadata: Metadata = {
  title: 'Discord Stream Hub',
  description: 'Auth hub, shoutout bot, admin support, and community tools.',
  icons: {
    icon: '/brand/discord-stream-hub-icon-192.png',
    apple: '/brand/discord-stream-hub-icon-192.png',
    shortcut: '/favicon.ico',
  },
};

// Polling initialization moved to /api/startup route to prevent hot reload issues

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          'min-h-screen bg-background font-body antialiased'
        )}
      >
        <div className="star-field"></div>
        <div className="star-field-2"></div>
        <div className="star-field-3"></div>
        <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <DataComponentsProvider>
              {children}
            </DataComponentsProvider>
            <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
