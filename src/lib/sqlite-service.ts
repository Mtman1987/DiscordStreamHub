import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { getDatabaseFilePath } from './runtime-config';
import { discoverDirectChildIds } from './tenant-utils';

const Database = require('better-sqlite3');

type StoredDoc = {
  path: string;
  collection_path: string;
  doc_id: string;
  data: string;
};

type StoredState = {
  docs: Record<string, StoredDoc>;
};

const IS_BUILD_DB = process.env.DSH_BUILD_DB === '1';
const STORAGE_PATH = IS_BUILD_DB
  ? join(process.cwd(), '.next-build-data', String(process.pid))
  : process.env.NODE_ENV === 'production'
    ? '/data'
    : join(process.cwd(), 'data');
const DB_PATH = IS_BUILD_DB ? join(STORAGE_PATH, 'app.db') : getDatabaseFilePath() || join(STORAGE_PATH, 'app.db');
const LEGACY_JSON_PATH = join(STORAGE_PATH, 'app.db.json');

function ensureStorage(): void {
  if (!existsSync(STORAGE_PATH)) {
    mkdirSync(STORAGE_PATH, { recursive: true });
  }
}

function readJsonState(path = LEGACY_JSON_PATH): StoredState {
  ensureStorage();

  if (!existsSync(path)) return { docs: {} };
  try {
    const raw = readFileSync(path, 'utf8');
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

function cloneData<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

export class SQLiteService {
  private db: any;

  constructor() {
    ensureStorage();
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        path TEXT PRIMARY KEY,
        collection_path TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `);
    this.migrateLegacyJsonStore();
  }

  private migrateLegacyJsonStore(): void {
    if (!existsSync(LEGACY_JSON_PATH)) return;

    const state = readJsonState();
    const docs = Object.values(state.docs || {});
    if (docs.length === 0) return;

    const upsert = this.db.prepare(`
      INSERT INTO docs (path, collection_path, doc_id, data)
      VALUES (@path, @collection_path, @doc_id, @data)
      ON CONFLICT(path) DO UPDATE SET
        collection_path = excluded.collection_path,
        doc_id = excluded.doc_id,
        data = excluded.data
    `);

    const migrate = this.db.transaction((rows: StoredDoc[]) => {
      for (const row of rows) upsert.run(row);
    });

    migrate(docs);

    try {
      renameSync(LEGACY_JSON_PATH, `${LEGACY_JSON_PATH}.migrated-${Date.now()}`);
    } catch {
      writeFileSync(LEGACY_JSON_PATH, JSON.stringify({ docs: {} }, null, 2));
    }

    console.log(`[SQLiteDB] Migrated ${docs.length} JSON docs into ${DB_PATH}`);
  }

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

    const fullPath = `${collection}/${docId}`;
    const row = this.db.prepare('SELECT doc_id, data FROM docs WHERE path = ?').get(fullPath);

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

    let docs = this.db.prepare('SELECT doc_id, data FROM docs WHERE collection_path = ?').all(collection)
      .map((row: any) => ({
        id: row.doc_id,
        ...JSON.parse(row.data)
      }));

    if (options.whereField && options.whereValue !== undefined) {
      docs = docs.filter((doc: any) => {
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
      docs.sort((a: any, b: any) => {
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

    return { docs: docs.map((doc: any) => cloneData(doc)) };
  }

  listDescendantDocumentIds(collectionPath: string): string[] {
    const normalizedCollection = collectionPath.split('/').filter(Boolean).join('/');
    if (!normalizedCollection) return [];

    const prefix = `${normalizedCollection}/`;
    const rows = this.db
      .prepare('SELECT path FROM docs WHERE substr(path, 1, ?) = ?')
      .all(prefix.length, prefix) as Array<{ path: string }>;

    return discoverDirectChildIds(normalizedCollection, rows.map((row) => row.path));
  }

  setDoc(path: string, data: any, merge: boolean = false): void {
    const { collection, docId, isCollection } = this.parsePath(path);

    if (isCollection || !docId) {
      throw new Error('Cannot set document on collection path');
    }

    const fullPath = `${collection}/${docId}`;
    const existing = this.db.prepare('SELECT data FROM docs WHERE path = ?').get(fullPath);
    const finalData = merge && existing ? { ...JSON.parse(existing.data), ...cloneData(data) } : cloneData(data);
    const row = {
      path: fullPath,
      collection_path: collection,
      doc_id: docId,
      data: JSON.stringify(finalData)
    };

    this.db.prepare(`
      INSERT INTO docs (path, collection_path, doc_id, data)
      VALUES (@path, @collection_path, @doc_id, @data)
      ON CONFLICT(path) DO UPDATE SET
        collection_path = excluded.collection_path,
        doc_id = excluded.doc_id,
        data = excluded.data
    `).run(row);
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

    const fullPath = `${collection}/${docId}`;
    this.db.prepare('DELETE FROM docs WHERE path = ?').run(fullPath);
  }

  async getDocument(collection: string, docId: string): Promise<any | null> {
    const result = this.getDoc(`${collection}/${docId}`);
    return result.exists ? result.data : null;
  }

  async setDocument(collection: string, docId: string, data: any): Promise<void> {
    this.setDoc(`${collection}/${docId}`, data);
  }

  close(): void {
    this.db.close();
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
