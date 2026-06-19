'use client';

import React, { DependencyList, createContext, useContext, ReactNode, useMemo, useState } from 'react';
import { DataErrorListener } from '@/components/DataErrorListener'

type AppHandle = any;
type DataHandle = any;
type Auth = any;
type User = any;

const LOCAL_DATA_APP = { name: 'local-session' };
const LOCAL_DATA_STORE = { name: 'local-db' };
const LOCAL_AUTH = { name: 'local-auth' };
const LOCAL_USER = { uid: 'local-session' };

interface DataProviderProps {
  children: ReactNode;
  dataApp: AppHandle;
  store: DataHandle;
  auth: Auth;
}

export interface DataContextState {
  areServicesAvailable: boolean;
  dataApp: AppHandle | null;
  store: DataHandle | null;
  auth: Auth | null;
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface DataServicesAndUser {
  dataApp: AppHandle;
  store: DataHandle;
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

export const DataContext = createContext<DataContextState | undefined>(undefined);

export const DataProvider: React.FC<DataProviderProps> = ({
  children,
  dataApp,
  store,
  auth,
}) => {
  const [userAuthState, setUserAuthState] = useState<Omit<DataContextState, 'areServicesAvailable' | 'dataApp' | 'store' | 'auth'>>({
    user: LOCAL_USER,
    isUserLoading: false,
    userError: null,
  });

  void setUserAuthState;

  // Data is intentionally stubbed out in this build.
  // Keep the context stable so downstream components can render without the SDK.

  const contextValue = useMemo((): DataContextState => {
    const servicesAvailable = !!(dataApp && store && auth);
    return {
      areServicesAvailable: servicesAvailable,
      dataApp: servicesAvailable ? dataApp : null,
      store: servicesAvailable ? store : null,
      auth: servicesAvailable ? auth : null,
      ...userAuthState,
    };
  }, [dataApp, store, auth, userAuthState]);

  return (
    <DataContext.Provider value={contextValue}>
      <DataErrorListener />
      {children}
    </DataContext.Provider>
  );
};

export const useData = (): DataServicesAndUser => {
  const context = useContext(DataContext);

  if (context === undefined) {
    return {
      dataApp: LOCAL_DATA_APP as any,
      store: LOCAL_DATA_STORE as any,
      auth: LOCAL_AUTH as any,
      user: LOCAL_USER,
      isUserLoading: false,
      userError: null,
    };
  }

  if (!context.areServicesAvailable || !context.dataApp || !context.store || !context.auth) {
    return {
      dataApp: LOCAL_DATA_APP as any,
      store: LOCAL_DATA_STORE as any,
      auth: LOCAL_AUTH as any,
      user: context.user || LOCAL_USER,
      isUserLoading: false,
      userError: context.userError,
    };
  }

  return {
    dataApp: context.dataApp,
    store: context.store,
    auth: context.auth,
    user: context.user,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
  };
};

export const useAuth = (): Auth => {
  const { auth } = useData();
  return auth as Auth;
};

export const useDataStore = (): DataHandle => {
  const { store } = useData();
  return store as DataHandle;
};

export const useDataApp = (): AppHandle => {
  const { dataApp } = useData();
  return dataApp as AppHandle;
};

export const useUser = (): UserHookResult => {
  const context = useContext(DataContext);

  if (context === undefined) {
    return {
      user: LOCAL_USER,
      isUserLoading: false,
      userError: null,
    };
  }

  return {
    user: context.user || LOCAL_USER,
    isUserLoading: false,
    userError: context.userError,
  };
};

type MemoData <T> = T & {__memo?: boolean};

export function useMemoData<T>(factory: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
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
