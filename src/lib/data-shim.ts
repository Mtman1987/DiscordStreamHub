'use client';

// Client-side store compatibility shim.
// Existing pages still import from `@/lib/data-shim`, but the app now reads
// and writes through the local /api/db layer.

import { dbGet, dbSet, dbUpdate, dbDelete, dbList } from '@/hooks/use-db';

export type DocumentData = Record<string, any>;
export type DataError = Error;
export type DocumentSnapshot<T = DocumentData> = {
  exists: () => boolean;
  data: () => T;
  id: string;
};
export type QuerySnapshot<T = DocumentData> = {
  docs: Array<{ id: string; data: () => T; ref: StubDocRef }>;
};
export type DocumentReference<T = DocumentData> = StubDocRef & { __type?: T };
export type CollectionReference<T = DocumentData> = StubCollRef & { __type?: T; type?: 'collection' };
export type Query<T = DocumentData> = StubCollRef & { __type?: T; type?: 'query' | 'collection' };

export class StubDocRef {
  _path: string;

  constructor(path: string) {
    this._path = path;
  }

  get id() {
    return this._path.split('/').pop() || '';
  }

  get path() {
    return this._path;
  }
}

export class StubCollRef {
  _path: string;
  _orderBy?: { field: string; direction: 'asc' | 'desc' };
  _limit?: number;

  constructor(path: string, options?: { orderBy?: { field: string; direction: 'asc' | 'desc' }; limit?: number }) {
    this._path = path;
    this._orderBy = options?.orderBy;
    this._limit = options?.limit;
  }

  get type() {
    return 'collection' as const;
  }

  get path() {
    return this._path;
  }
}

export function doc(storeOrRef: any, ...pathSegments: string[]): StubDocRef {
  if (storeOrRef instanceof StubDocRef || storeOrRef instanceof StubCollRef) {
    return new StubDocRef(`${storeOrRef._path}/${pathSegments.join('/')}`);
  }

  return new StubDocRef(pathSegments.join('/'));
}

export function collection(storeOrRef: any, ...pathSegments: string[]): StubCollRef {
  if (storeOrRef instanceof StubDocRef || storeOrRef instanceof StubCollRef) {
    return new StubCollRef(`${storeOrRef._path}/${pathSegments.join('/')}`);
  }

  return new StubCollRef(pathSegments.join('/'));
}

export function query(ref: any, ..._constraints: any[]): any {
  if (!(ref instanceof StubCollRef)) return ref;
  const next = new StubCollRef(ref._path, { orderBy: ref._orderBy, limit: ref._limit });
  for (const constraint of _constraints) {
    if (constraint?.type === 'orderBy') {
      next._orderBy = { field: constraint.field, direction: constraint.direction };
    }
    if (constraint?.type === 'limit') {
      next._limit = constraint.value;
    }
  }
  return next;
}

export function orderBy(_field: string, _direction?: string): any {
  return { type: 'orderBy', field: _field, direction: _direction === 'asc' ? 'asc' : 'desc' };
}

export function limit(_n: number): any {
  return { type: 'limit', value: Math.max(0, Math.trunc(Number(_n || 0))) };
}

export function where(_field: string, _op: string, _value: any): any {
  return null;
}

function reviveTimestamps(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (obj._type === 'timestamp' && typeof obj.seconds === 'number') {
    return new Timestamp(obj.seconds, obj.nanoseconds || 0);
  }

  if (
    typeof obj.seconds === 'number' &&
    typeof obj.nanoseconds === 'number' &&
    Object.keys(obj).length <= 3
  ) {
    return new Timestamp(obj.seconds, obj.nanoseconds);
  }

  if (Array.isArray(obj)) {
    return obj.map(reviveTimestamps);
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = reviveTimestamps(value);
  }

  return result;
}

export async function getDoc(ref: StubDocRef): Promise<{ exists: () => boolean; data: () => any; id: string }> {
  const result = await dbGet(ref._path);

  return {
    exists: () => !!result,
    data: () => reviveTimestamps(result),
    id: ref.id,
  };
}

export async function getDocs(ref: StubCollRef): Promise<{ docs: Array<{ id: string; data: () => any; ref: StubDocRef }> }> {
  const results = await dbList(ref._path);

  return {
    docs: results.map(item => ({
      id: item.id,
      data: () => reviveTimestamps(item),
      ref: new StubDocRef(`${ref._path}/${item.id}`),
    })),
  };
}

export async function setDoc(ref: StubDocRef, data: any, options?: any): Promise<void> {
  await dbSet(ref._path, data, options?.merge);
}

export async function updateDoc(ref: StubDocRef, data: any): Promise<void> {
  await dbUpdate(ref._path, data);
}

export async function deleteDoc(ref: StubDocRef): Promise<void> {
  await dbDelete(ref._path);
}

export async function addDoc(ref: StubCollRef, data: any): Promise<StubDocRef> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: ref._path, data }),
  });
  const json = await res.json();
  return new StubDocRef(`${ref._path}/${json.id || 'unknown'}`);
}

export function onSnapshot(ref: any, callback: (snap: any) => void, onError?: (error: DataError) => void): () => void { let cancelled = false; const POLL_MS = 10 * 60 * 1000;
  const doFetch = () => { if (cancelled) return; if (ref instanceof StubDocRef) {
    dbGet(ref._path)
      .then(data => {
        callback({
          exists: () => !!data,
          data: () => reviveTimestamps(data),
          id: ref.id,
        });
      })
      .catch(error => onError?.(error));
  } else if (ref instanceof StubCollRef) {
    dbList(ref._path)
      .then(results => {
        let orderedResults = [...results];
        if (ref._orderBy?.field) {
          const { field, direction } = ref._orderBy;
          orderedResults.sort((a, b) => {
            const left = a?.[field];
            const right = b?.[field];
            const leftValue = typeof left === 'number' ? left : Number(left ?? 0);
            const rightValue = typeof right === 'number' ? right : Number(right ?? 0);
            const result = Number.isFinite(leftValue) && Number.isFinite(rightValue)
              ? leftValue - rightValue
              : String(left ?? '').localeCompare(String(right ?? ''));
            return direction === 'asc' ? result : -result;
          });
        }
        if (typeof ref._limit === 'number' && ref._limit > 0) {
          orderedResults = orderedResults.slice(0, ref._limit);
        }
        callback({
          docs: orderedResults.map(item => ({
            id: item.id,
            data: () => reviveTimestamps(item),
            ref: new StubDocRef(`${ref._path}/${item.id}`),
          })),
        });
      })
      .catch(error => onError?.(error));
  }

  }; doFetch(); const iv = setInterval(doFetch, POLL_MS); return () => { cancelled = true; clearInterval(iv); };
}

export class Timestamp {
  seconds: number;
  nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toDate(): Date {
    return new Date(this.seconds * 1000);
  }

  toMillis(): number {
    return this.seconds * 1000;
  }

  static fromDate(date: Date): Timestamp {
    return new Timestamp(Math.floor(date.getTime() / 1000), 0);
  }

  static now(): Timestamp {
    return Timestamp.fromDate(new Date());
  }

  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
}

