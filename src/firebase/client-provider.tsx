'use client';

import type { ReactNode } from 'react';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  return <>{children}</>;
}
