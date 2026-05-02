import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type StoredDoc = {
  path: string;
  collection_path: string;
  doc_id: string;
  data: string;
};

type StoredState = {
  docs: Record<string, StoredDoc>;
};

const STORAGE_PATH = process.env.NODE_ENV === 'production' ? '/data' : join(process.cwd(), 'data');
const DB_PATH = join(STORAGE_PATH, 'app.db.json');

function ensureStorage(): void {
  if (!existsSync(STORAGE_PATH)) {
    mkdirSync(STORAGE_PATH, { recursive: true });
  }
}

function readState(): StoredState {
  ensureStorage();

  if (!existsSync(DB_PATH)) {
    const initial: StoredState = { docs: {} };
    writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    const raw = readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredState;
    if (!parsed.docs || typeof parsed.docs !== 'object') {
      return { docs: {} };
    }
    return parsed;
  } catch (error) {
    console.error('[SQLiteDB] Failed to read state, resetting store:', error);
    return { docs: {} };
  }
}

function writeState(state: StoredState): void {
  ensureStorage();
  writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

function cloneData<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

export class SQLiteService {
  private parsePath(path: string): { collection: string; docId?: string; isCollection: boolean } {
    const segments = path.split('/').filter(Boolean);
    const isCollection = segments.length % 2 === 1;

    if (isCollection) {
      return {
        collection: segments.join('/'),
        isCollection: true
      };
    }

    const docId = segments.pop()!;
    return {
      collection: segments.join('/'),
      docId,
      isCollection: false
    };
  }

  getDoc(path: string): { exists: boolean; id?: string; data?: any } {
    const { collection, docId, isCollection } = this.parsePath(path);

    if (isCollection || !docId) {
      throw new Error('Cannot get document from collection path');
    }

    const state = readState();
    const fullPath = `${collection}/${docId}`;
    const row = state.docs[fullPath];

    if (!row) {
      return { exists: false };
    }

    return {
      exists: true,
      id: row.doc_id,
      data: JSON.parse(row.data)
    };
  }

  getCollection(
    path: string,
    options: {
      orderBy?: string;
      orderDir?: 'asc' | 'desc';
      limit?: number;
      whereField?: string;
      whereOp?: string;
      whereValue?: any;
    } = {}
  ): { docs: any[] } {
    const { collection, isCollection } = this.parsePath(path);

    if (!isCollection) {
      throw new Error('Cannot get collection from document path');
    }

    const state = readState();
    let docs = Object.values(state.docs)
      .filter(row => row.collection_path === collection)
      .map(row => ({
        id: row.doc_id,
        ...JSON.parse(row.data)
      }));

    if (options.whereField && options.whereValue !== undefined) {
      docs = docs.filter(doc => {
        const value = doc[options.whereField!];
        const op = options.whereOp || '==';
        switch (op) {
          case '==': return value === options.whereValue;
          case '!=': return value !== options.whereValue;
          case '>': return value > options.whereValue;
          case '>=': return value >= options.whereValue;
          case '<': return value < options.whereValue;
          case '<=': return value <= options.whereValue;
          default: return false;
        }
      });
    }

    if (options.orderBy) {
      docs.sort((a, b) => {
        const aVal = a[options.orderBy!];
        const bVal = b[options.orderBy!];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return options.orderDir === 'desc' ? 1 : -1;
        if (bVal == null) return options.orderDir === 'desc' ? -1 : 1;
        if (aVal < bVal) return options.orderDir === 'desc' ? 1 : -1;
        if (aVal > bVal) return options.orderDir === 'desc' ? -1 : 1;
        return 0;
      });
    }

    if (options.limit) {
      docs = docs.slice(0, options.limit);
    }

    return { docs: docs.map(doc => cloneData(doc)) };
  }

  setDoc(path: string, data: any, merge: boolean = false): void {
    const { collection, docId, isCollection } = this.parsePath(path);

    if (isCollection || !docId) {
      throw new Error('Cannot set document on collection path');
    }

    const state = readState();
    const fullPath = `${collection}/${docId}`;
    const existing = state.docs[fullPath];
    const finalData = merge && existing ? { ...JSON.parse(existing.data), ...cloneData(data) } : cloneData(data);

    state.docs[fullPath] = {
      path: fullPath,
      collection_path: collection,
      doc_id: docId,
      data: JSON.stringify(finalData)
    };

    writeState(state);
  }

  addDoc(path: string, data: any): { id: string } {
    const { collection, isCollection } = this.parsePath(path);

    if (!isCollection) {
      throw new Error('Cannot add document to document path');
    }

    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    this.setDoc(`${collection}/${id}`, data, false);
    return { id };
  }

  updateDoc(path: string, data: any): void {
    const existing = this.getDoc(path);
    if (!existing.exists) {
      throw new Error('Document does not exist');
    }

    this.setDoc(path, { ...existing.data, ...cloneData(data) }, false);
  }

  deleteDoc(path: string): void {
    const { collection, docId, isCollection } = this.parsePath(path);

    if (isCollection || !docId) {
      throw new Error('Cannot delete collection path');
    }

    const state = readState();
    const fullPath = `${collection}/${docId}`;
    delete state.docs[fullPath];
    writeState(state);
  }

  async getDocument(collection: string, docId: string): Promise<any | null> {
    const result = this.getDoc(`${collection}/${docId}`);
    return result.exists ? result.data : null;
  }

  async setDocument(collection: string, docId: string, data: any): Promise<void> {
    this.setDoc(`${collection}/${docId}`, data);
  }

  close(): void {
    // No persistent connection to close.
  }
}

let sqliteServiceInstance: SQLiteService | null = null;

export function getSQLiteService(): SQLiteService {
  if (!sqliteServiceInstance) {
    sqliteServiceInstance = new SQLiteService();
  }
  return sqliteServiceInstance;
}

export const sqliteService = getSQLiteService();
