'use client';

// Client SDK removed - using local file-based database on server
// These are no-op stubs to prevent import errors in existing client components

export function initializeData() {
  return {
    dataApp: null as any,
    auth: null as any,
    store: null as any,
  };
}

export function getSdks(dataApp: any) {
  return {
    dataApp,
    auth: null as any,
    store: null as any,
  };
}

export * from './provider';
export * from './client-provider';
export * from './store/use-collection';
export * from './store/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';

import { DataClientProvider as DataComponentsProvider } from '@/data/client-provider';
export { DataComponentsProvider };
