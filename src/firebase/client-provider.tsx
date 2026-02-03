'use client';

import React, { useMemo, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase, initiateAnonymousSignIn } from '@/firebase';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const firebaseServices = useMemo(() => {
    return initializeFirebase();
  }, []);

  useEffect(() => {
    // This ensures a user is always signed in anonymously.
    // It's non-blocking and the onAuthStateChanged listener in FirebaseProvider
    // will handle the user state update.
    if (firebaseServices.auth.currentUser === null) {
      initiateAnonymousSignIn(firebaseServices.auth);
    }
  }, [firebaseServices.auth]);

  return (
    <FirebaseProvider {...firebaseServices}>
      {children}
    </FirebaseProvider>
  );
}
