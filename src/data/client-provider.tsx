'use client';

import type { ReactNode } from 'react';
import { WorkspaceTruthProvider } from '@/components/workspace-truth-provider';

interface DataClientProviderProps {
  children: ReactNode;
}

export function DataClientProvider({ children }: DataClientProviderProps) {
  return <WorkspaceTruthProvider>{children}</WorkspaceTruthProvider>;
}
