'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type WithId<T> = T & { id: string };

// --- useDbDoc: replaces useDoc + useDataStore + doc() ---
export function useDbDoc<T = any>(path: string | null | undefined): {
  data: WithId<T> | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<WithId<T> | null>(null);
  const [isLoading, setIsLoading] = useState(!!path);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!path) { setData(null); setIsLoading(false); return; }
    setIsLoading(true);
    fetch(`/api/db?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(res => {
        if (res.exists && res.data) {
          setData({ ...res.data, id: res.id } as WithId<T>);
        } else {
          setData(null);
        }
        setError(null);
      })
      .catch(e => { setError(e); setData(null); })
      .finally(() => setIsLoading(false));
  }, [path]);

  return { data, isLoading, error };
}

// --- useDbCollection: replaces useCollection + useDataStore + collection/query ---
export function useDbCollection<T = any>(
  path: string | null | undefined,
  options?: {
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
    limit?: number;
    whereField?: string;
    whereOp?: string;
    whereValue?: string;
  }
): {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState(!!path);
  const [error, setError] = useState<Error | null>(null);
  const fetchCount = useRef(0);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const doFetch = useCallback(() => {
    if (!path) { setData(null); setIsLoading(false); return; }
    setIsLoading(true);
    const params = new URLSearchParams({ path });
    if (options?.orderBy) params.set('orderBy', options.orderBy);
    if (options?.orderDir) params.set('orderDir', options.orderDir);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.whereField) params.set('whereField', options.whereField);
    if (options?.whereOp) params.set('whereOp', options.whereOp);
    if (options?.whereValue !== undefined) params.set('whereValue', String(options.whereValue));

    fetch(`/api/db?${params}`)
      .then(r => r.json())
      .then(res => {
        setData((res.docs || []) as WithId<T>[]);
        setError(null);
      })
      .catch(e => { setError(e); setData(null); })
      .finally(() => setIsLoading(false));
  }, [path, options?.orderBy, options?.orderDir, options?.limit, options?.whereField, options?.whereOp, options?.whereValue]);

  useEffect(() => { doFetch(); }, [doFetch]);

  return { data, isLoading, error, refetch: doFetch };
}

// --- dbSet: replaces setDoc ---
export async function dbSet(path: string, data: any, merge?: boolean): Promise<void> {
  await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, data, merge }),
  });
  window.dispatchEvent(new CustomEvent('dsh-db-updated', { detail: { path } }));
}

// --- dbUpdate: replaces updateDoc ---
export async function dbUpdate(path: string, data: any): Promise<void> {
  await fetch('/api/db', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, data }),
  });
  window.dispatchEvent(new CustomEvent('dsh-db-updated', { detail: { path } }));
}

// --- dbDelete: replaces deleteDoc ---
export async function dbDelete(path: string): Promise<void> {
  await fetch(`/api/db?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  window.dispatchEvent(new CustomEvent('dsh-db-updated', { detail: { path } }));
}

// --- dbGet: one-shot doc read (replaces getDoc) ---
export async function dbGet<T = any>(path: string): Promise<(T & { id: string }) | null> {
  const res = await fetch(`/api/db?path=${encodeURIComponent(path)}`);
  const json = await res.json();
  if (json.exists && json.data) return { ...json.data, id: json.id } as T & { id: string };
  return null;
}

// --- dbList: one-shot collection read (replaces getDocs) ---
export async function dbList<T = any>(path: string, options?: {
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  whereField?: string;
  whereOp?: string;
  whereValue?: string;
}): Promise<(T & { id: string })[]> {
  const params = new URLSearchParams({ path });
  if (options?.orderBy) params.set('orderBy', options.orderBy);
  if (options?.orderDir) params.set('orderDir', options.orderDir);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.whereField) params.set('whereField', options.whereField);
  if (options?.whereOp) params.set('whereOp', options.whereOp);
  if (options?.whereValue !== undefined) params.set('whereValue', String(options.whereValue));
  const res = await fetch(`/api/db?${params}`);
  const json = await res.json();
  return (json.docs || []) as (T & { id: string })[];
}
