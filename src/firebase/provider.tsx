'use client';

import React, { DependencyList, createContext, useContext, ReactNode, useMemo, useState } from 'react';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener'

type FirebaseApp = any;
type Firestore = any;
type Auth = any;
type User = any;

interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
}

export interface FirebaseContextState {
  areServicesAvailable: boolean;
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null;
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface FirebaseServicesAndUser {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface UserHookResult {
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
}) => {
  const [userAuthState, setUserAuthState] = useState<Omit<FirebaseContextState, 'areServicesAvailable' | 'firebaseApp' | 'firestore' | 'auth'>>({
    user: { uid: 'local-session' },
    isUserLoading: false,
    userError: null,
  });

  void setUserAuthState;

  // Firebase is intentionally stubbed out in this build.
  // Keep the context stable so downstream components can render without the SDK.

  const contextValue = useMemo((): FirebaseContextState => {
    const servicesAvailable = !!(firebaseApp && firestore && auth);
    return {
      areServicesAvailable: servicesAvailable,
      firebaseApp: servicesAvailable ? firebaseApp : null,
      firestore: servicesAvailable ? firestore : null,
      auth: servicesAvailable ? auth : null,
      ...userAuthState,
    };
  }, [firebaseApp, firestore, auth, userAuthState]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = (): FirebaseServicesAndUser => {
  const context = useContext(FirebaseContext);

  if (context === undefined) {
    return {
      firebaseApp: {} as any,
      firestore: {} as any,
      auth: {} as any,
      user: { uid: 'local-session' },
      isUserLoading: false,
      userError: null,
    };
  }

  if (!context.areServicesAvailable || !context.firebaseApp || !context.firestore || !context.auth) {
    return {
      firebaseApp: {} as any,
      firestore: {} as any,
      auth: {} as any,
      user: context.user || { uid: 'local-session' },
      isUserLoading: false,
      userError: context.userError,
    };
  }

  return {
    firebaseApp: context.firebaseApp,
    firestore: context.firestore,
    auth: context.auth,
    user: context.user,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
  };
};

export const useAuth = (): Auth => {
  const { auth } = useFirebase();
  return auth as Auth;
};

export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  return firestore as Firestore;
};

export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  return firebaseApp as FirebaseApp;
};

export const useUser = (): UserHookResult => {
  const context = useContext(FirebaseContext);

  if (context === undefined) {
    return {
      user: { uid: 'local-session' },
      isUserLoading: false,
      userError: null,
    };
  }

  return {
    user: context.user || { uid: 'local-session' },
    isUserLoading: false,
    userError: context.userError,
  };
};

type MemoFirebase <T> = T & {__memo?: boolean};

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T {
  const memoized = useMemo(factory, deps);
  
  if(typeof memoized === 'object' && memoized !== null) {
    Object.defineProperty(memoized, '__memo', {
        value: true,
        writable: false,
        enumerable: false,
    });
  }
  
  return memoized;
}
