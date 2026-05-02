import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.NODE_ENV === 'production' 
      ? '/data/app.db' 
      : join(process.cwd(), 'data', 'app.db');
    
    console.log('[SQLiteDB] Using SQLite database at', dbPath);
    
    // Create /data dir for Docker build/Fly volume
    const dir = process.env.NODE_ENV === 'production' ? '/data' : 'data';
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log('[SQLiteDB] Created dir:', dir);
    }
    
    // Create DB file if not exists
    if (!existsSync(dbPath)) {
      const tempDb = new Database(dbPath);
      tempDb.exec(`
        CREATE TABLE IF NOT EXISTS docs (
          path TEXT PRIMARY KEY,
          collection_path TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          data TEXT NOT NULL
        )
      `);
      tempDb.close();
      console.log('[SQLiteDB] Initialized new DB at', dbPath);
    }
    
    db = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 1000000');
    db.pragma('foreign_keys = true');
    db.pragma('temp_store = memory');
    
    // Initialize tables
    initializeTables(db);
  }
  return db;
}

function initializeTables(db: Database.Database) {
  // The docs table already exists with the correct structure:
  // CREATE TABLE docs (path TEXT PRIMARY KEY, collection_path TEXT NOT NULL, doc_id TEXT NOT NULL, data TEXT NOT NULL)
  // Don't create any new tables - use the existing one
  console.log('[SQLiteDB] Using existing docs table structure');
}

export class SQLiteService {
  private db: Database.Database;

  constructor() {
    this.db = getDb();
  }

  // Convert Firestore-style path to collection and document ID
  private parsePath(path: string): { collection: string; docId?: string; isCollection: boolean } {
    const segments = path.split('/').filter(Boolean);
    const isCollection = segments.length % 2 === 1;
    
    if (isCollection) {
      return {
        collection: segments.join('/'),
        isCollection: true
      };
    } else {
      const docId = segments.pop()!;
      const collection = segments.join('/');
      return {
        collection,
        docId,
        isCollection: false
      };
    }
  }

  // Get a single document - USE EXISTING DOCS TABLE
  getDoc(path: string): { exists: boolean; id?: string; data?: any } {
    const { collection, docId, isCollection } = this.parsePath(path);
    
    if (isCollection) {
      throw new Error('Cannot get document from collection path');
    }

    const fullPath = `${collection}/${docId}`;
    const stmt = this.db.prepare('SELECT * FROM docs WHERE path = ?');
    const row = stmt.get(fullPath) as any;
    
    if (!row) {
      return { exists: false };
    }

    return {
      exists: true,
      id: row.doc_id,
      data: JSON.parse(row.data)
    };
  }

  // Get collection documents - USE EXISTING DOCS TABLE
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

    let sql = 'SELECT * FROM docs WHERE collection_path = ?';
    const params: any[] = [collection];

    // Add LIMIT
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    let docs = rows.map(row => ({
      id: row.doc_id,
      ...JSON.parse(row.data)
    }));

    // Apply filters and sorting in JavaScript since SQLite JSON functions might not work
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

    return { docs };
  }

  // Set document - USE EXISTING DOCS TABLE
  setDoc(path: string, data: any, merge: boolean = false): void {
    const { collection, docId, isCollection } = this.parsePath(path);
    
    if (isCollection) {
      throw new Error('Cannot set document on collection path');
    }

    const fullPath = `${collection}/${docId}`;
    let finalData = data;
    
    if (merge) {
      // Get existing data and merge
      const existing = this.getDoc(path);
      if (existing.exists) {
        finalData = { ...existing.data, ...data };
      }
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO docs (path, collection_path, doc_id, data)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(fullPath, collection, docId, JSON.stringify(finalData));
  }

  // Add document to collection (auto-generate ID) - USE EXISTING DOCS TABLE
  addDoc(path: string, data: any): { id: string } {
    const { collection, isCollection } = this.parsePath(path);
    
    if (!isCollection) {
      throw new Error('Cannot add document to document path');
    }

    const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullPath = `${collection}/${id}`;

    const stmt = this.db.prepare(`
      INSERT INTO docs (path, collection_path, doc_id, data)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(fullPath, collection, id, JSON.stringify(data));
    
    return { id };
  }

  // Update document - USE EXISTING DOCS TABLE
  updateDoc(path: string, data: any): void {
    const existing = this.getDoc(path);
    if (!existing.exists) {
      throw new Error('Document does not exist');
    }

    const mergedData = { ...existing.data, ...data };
    this.setDoc(path, mergedData, false);
  }

  // Delete document - USE EXISTING DOCS TABLE
  deleteDoc(path: string): void {
    const { collection, docId, isCollection } = this.parsePath(path);
    
    if (isCollection) {
      throw new Error('Cannot delete collection path');
    }

    const fullPath = `${collection}/${docId}`;
    const stmt = this.db.prepare('DELETE FROM docs WHERE path = ?');
    stmt.run(fullPath);
  }

  // Get document by collection and document ID (for compatibility)
  async getDocument(collection: string, docId: string): Promise<any | null> {
    const path = `${collection}/${docId}`;
    const result = this.getDoc(path);
    return result.exists ? result.data : null;
  }

  // Set document by collection and document ID (for compatibility)
  async setDocument(collection: string, docId: string, data: any): Promise<void> {
    const path = `${collection}/${docId}`;
    this.setDoc(path, data);
  }

  // Close database connection
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

// Singleton instance
let sqliteServiceInstance: SQLiteService | null = null;

export function getSQLiteService(): SQLiteService {
  if (!sqliteServiceInstance) {
    sqliteServiceInstance = new SQLiteService();
  }
  return sqliteServiceInstance;
}

// Export singleton instance
export const sqliteService = getSQLiteService();
