'use client';

import { useCurrentUser } from '@/hooks/use-current-user';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-bold">Admin Access Required</h2>
        <p className="text-muted-foreground max-w-sm">
          This page is restricted to server administrators. If you think you should have access, contact your server owner.
        </p>
        <Button asChild><Link href="/dashboard">Go to Dashboard</Link></Button>
      </div>
    );
  }

  return <>{children}</>;
}
