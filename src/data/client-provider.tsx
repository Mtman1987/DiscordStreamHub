'use client';

import type { ReactNode } from 'react';

interface DataClientProviderProps {
  children: ReactNode;
}

export function DataClientProvider({ children }: DataClientProviderProps) {
  return <>{children}</>;
}
