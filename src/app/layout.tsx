import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/theme-provider';
import { FirebaseComponentsProvider } from '@/firebase';

export const metadata: Metadata = {
  title: "Discord Streamer's Hub",
  description: 'Manage your Discord community with AI-powered tools.',
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
            <FirebaseComponentsProvider>
              {children}
            </FirebaseComponentsProvider>
            <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
