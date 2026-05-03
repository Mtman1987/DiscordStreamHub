'use client';

// Firebase client SDK removed - using local file-based database on server
// These are no-op stubs to prevent import errors in existing client components

export function initializeFirebase() {
  return {
    firebaseApp: null as any,
    auth: null as any,
    firestore: null as any,
  };
}

export function getSdks(firebaseApp: any) {
  return {
    firebaseApp,
    auth: null as any,
    firestore: null as any,
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';

import { FirebaseClientProvider as FirebaseComponentsProvider } from '@/firebase/client-provider';
export { FirebaseComponentsProvider };
