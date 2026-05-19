import { sqliteService } from './sqlite-service';

// Compatibility layer to map old db interface to new sqlite-service
// This allows all existing code to work without changes

class DatabaseCompatibilityLayer {
  doc(path: string): any {
    const segments = path.split('/').filter(Boolean);
    if (segments.length % 2 !== 0) {
      throw new Error(`Document path must have an even number of segments: ${path}`);
    }

    const docId = segments.pop()!;
    const collectionPath = segments.join('/');
    return this.collection(collectionPath).doc(docId);
  }

  // Map old db.get() calls to new sqlite-service
  get(collectionPath: string, docId: string): any {
    try {
      const result = sqliteService.getDoc(`${collectionPath}/${docId}`);
      return result.exists ? result.data : null;
    } catch (error) {
      console.error(`[DB Compat] get(${collectionPath}, ${docId}) failed:`, error);
      return null;
    }
  }

  // Map old db.set() calls to new sqlite-service
  set(collectionPath: string, docId: string, data: any, options?: { merge?: boolean }): void {
    try {
      sqliteService.setDoc(`${collectionPath}/${docId}`, data, options?.merge || false);
    } catch (error) {
      console.error(`[DB Compat] set(${collectionPath}, ${docId}) failed:`, error);
    }
  }

  // Map old db.update() calls to new sqlite-service
  update(collectionPath: string, docId: string, data: any): void {
    try {
      sqliteService.updateDoc(`${collectionPath}/${docId}`, data);
    } catch (error) {
      console.error(`[DB Compat] update(${collectionPath}, ${docId}) failed:`, error);
    }
  }

  // Map old db.delete() calls to new sqlite-service
  delete(collectionPath: string, docId: string): void {
    try {
      sqliteService.deleteDoc(`${collectionPath}/${docId}`);
    } catch (error) {
      console.error(`[DB Compat] delete(${collectionPath}, ${docId}) failed:`, error);
    }
  }

  // Async variants for compatibility with code that uses db.setAsync / db.getAsync
  async setAsync(collectionPath: string, docId: string, data: any): Promise<void> {
    this.set(collectionPath, docId, data);
  }

  async getAsync(collectionPath: string, docId: string): Promise<any> {
    return this.get(collectionPath, docId);
  }

  // Map old db.query() calls to new sqlite-service
  query(
    collectionPath: string, 
    filters?: Array<{ field: string; op: string; value: any }>,
    orderBy?: string,
    limit?: number
  ): any[] {
    try {
      const options: any = {};
      
      if (filters && filters.length > 0) {
        const filter = filters[0]; // Take first filter for simplicity
        options.whereField = filter.field;
        options.whereOp = filter.op;
        options.whereValue = filter.value;
      }
      
      if (orderBy) options.orderBy = orderBy;
      if (limit) options.limit = limit;

      const result = sqliteService.getCollection(collectionPath, options);
      
      // Return in old format: array of objects with id and data properties
      return result.docs.map(doc => ({
        id: doc.id,
        data: { ...doc },
        exists: true
      }));
    } catch (error) {
      console.error(`[DB Compat] query(${collectionPath}) failed:`, error);
      return [];
    }
  }

  // Map old db.collection().doc().get() pattern
  collection(collectionPath: string) {
    return {
      doc: (docId?: string) => {
        const actualId = docId || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const docPath = `${collectionPath}/${actualId}`;
        const docRef: any = {
          path: docPath,
          _path: docPath,
          get: async () => {
            try {
              const result = sqliteService.getDoc(docPath);
              return {
                exists: result.exists,
                data: () => result.data,
                id: docId,
                ref: docRef
              };
            } catch (error) {
              console.error(`[DB Compat] collection(${collectionPath}).doc(${docId}).get() failed:`, error);
              return { exists: false, data: () => null, ref: docRef };
            }
          },
          set: async (data: any, options?: { merge?: boolean }) => {
            try {
              sqliteService.setDoc(docPath, data, options?.merge || false);
            } catch (error) {
              console.error(`[DB Compat] collection(${collectionPath}).doc(${docId}).set() failed:`, error);
            }
          },
          update: async (data: any) => {
            try {
              // Use set with merge if doc doesn't exist yet
              const existing = sqliteService.getDoc(docPath);
              if (existing.exists) {
                sqliteService.updateDoc(docPath, data);
              } else {
                sqliteService.setDoc(docPath, data, false);
              }
            } catch (error) {
              console.error(`[DB Compat] collection(${collectionPath}).doc(${docId}).update() failed:`, error);
            }
          },
          delete: async () => {
            try {
              sqliteService.deleteDoc(docPath);
            } catch (error) {
              console.error(`[DB Compat] collection(${collectionPath}).doc(${docId}).delete() failed:`, error);
            }
          },
          collection: (subCollectionPath: string) => {
            return this.collection(`${collectionPath}/${actualId}/${subCollectionPath}`);
          }
        };
        return docRef;
      },
      get: async () => {
        try {
          const result = sqliteService.getCollection(collectionPath);
          const self = this;
          return {
            empty: result.docs.length === 0,
            size: result.docs.length,
            docs: result.docs.map(doc => {
              const docPath = `${collectionPath}/${doc.id}`;
              return {
                id: doc.id,
                data: () => ({ ...doc }),
                exists: true,
                ref: { path: docPath, _path: docPath, collection: (sub: string) => self.collection(`${collectionPath}/${doc.id}/${sub}`), delete: async () => sqliteService.deleteDoc(docPath), update: async (data: any) => { try { sqliteService.updateDoc(docPath, data); } catch { sqliteService.setDoc(docPath, data, false); } } }
              };
            }),
            forEach: function(cb: (doc: any) => void) { this.docs.forEach(cb); }
          };
        } catch (error) {
          console.error(`[DB Compat] collection(${collectionPath}).get() failed:`, error);
          return { docs: [], empty: true, size: 0, forEach: () => {} };
        }
      },
      where: (field: string, op: string, value: any) => {
        const self = this;
        return {
        get: async () => {
          try {
            const result = sqliteService.getCollection(collectionPath, {
              whereField: field,
              whereOp: op,
              whereValue: value
            });
            return {
              empty: result.docs.length === 0,
              size: result.docs.length,
              docs: result.docs.map(doc => {
                const docPath = `${collectionPath}/${doc.id}`;
                return {
                  id: doc.id,
                  data: () => ({ ...doc }),
                  exists: true,
                  ref: { path: docPath, _path: docPath, collection: (sub: string) => self.collection(`${collectionPath}/${doc.id}/${sub}`), delete: async () => sqliteService.deleteDoc(docPath), update: async (data: any) => { try { sqliteService.updateDoc(docPath, data); } catch { sqliteService.setDoc(docPath, data, false); } } }
                };
              }),
              forEach: function(cb: (doc: any) => void) { this.docs.forEach(cb); }
            };
          } catch (error) {
            console.error(`[DB Compat] collection(${collectionPath}).where() failed:`, error);
            return { docs: [], empty: true, size: 0, forEach: () => {} };
          }
        },
        limit: (limitNum: number) => ({
          get: async () => {
            try {
              const result = sqliteService.getCollection(collectionPath, {
                whereField: field,
                whereOp: op,
                whereValue: value,
                limit: limitNum
              });
              return {
                empty: result.docs.length === 0,
                size: result.docs.length,
                docs: result.docs.map(doc => {
                  const docPath = `${collectionPath}/${doc.id}`;
                  return {
                    id: doc.id,
                    data: () => ({ ...doc }),
                    exists: true,
                    ref: { path: docPath, _path: docPath, collection: (sub: string) => self.collection(`${collectionPath}/${doc.id}/${sub}`), delete: async () => sqliteService.deleteDoc(docPath), update: async (data: any) => { try { sqliteService.updateDoc(docPath, data); } catch { sqliteService.setDoc(docPath, data, false); } } }
                  };
                }),
                forEach: function(cb: (doc: any) => void) { this.docs.forEach(cb); }
              };
            } catch (error) {
              console.error(`[DB Compat] collection(${collectionPath}).where().limit() failed:`, error);
              return { docs: [], empty: true, size: 0, forEach: () => {} };
            }
          }
        })
        };
      },
      orderBy: (field: string, direction?: 'asc' | 'desc') => ({
        get: async () => {
          try {
            const result = sqliteService.getCollection(collectionPath, {
              orderBy: field,
              orderDir: direction || 'asc'
            });
            return {
              docs: result.docs.map(doc => ({
                id: doc.id,
                data: () => ({ ...doc }),
                exists: true
              }))
            };
          } catch (error) {
            console.error(`[DB Compat] collection(${collectionPath}).orderBy() failed:`, error);
            return { docs: [] };
          }
        },
        limit: (limitNum: number) => ({
          get: async () => {
            try {
              const result = sqliteService.getCollection(collectionPath, {
                orderBy: field,
                orderDir: direction || 'asc',
                limit: limitNum
              });
              return {
                docs: result.docs.map(doc => ({
                  id: doc.id,
                  data: () => ({ ...doc }),
                  exists: true
                }))
              };
            } catch (error) {
              console.error(`[DB Compat] collection(${collectionPath}).orderBy().limit() failed:`, error);
              return { docs: [] };
            }
          }
        })
      }),
      add: async (data: any) => {
        try {
          const result = sqliteService.addDoc(collectionPath, data);
          const docPath = `${collectionPath}/${result.id}`;
          return { id: result.id, path: docPath };
        } catch (error) {
          console.error(`[DB Compat] collection(${collectionPath}).add() failed:`, error);
          throw error;
        }
      }
    };
  }
  // Map old db.batch() calls to new sqlite-service
  batch() {
    const operations: Array<{ type: string; path: string; data: any; options?: any }> = [];
    
    return {
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        const path = typeof ref === 'string' ? ref : (ref?.path || ref?._path || '');
        if (!path) { console.error('[DB Compat] batch.set: no path on ref', ref); return; }
        operations.push({ type: 'set', path, data, options });
      },
      update: (ref: any, data: any) => {
        const path = typeof ref === 'string' ? ref : (ref?.path || ref?._path || '');
        if (!path) { console.error('[DB Compat] batch.update: no path on ref', ref); return; }
        operations.push({ type: 'update', path, data });
      },
      delete: (ref: any) => {
        const path = typeof ref === 'string' ? ref : (ref?.path || ref?._path || '');
        if (!path) { console.error('[DB Compat] batch.delete: no path on ref', ref); return; }
        operations.push({ type: 'delete', path, data: null });
      },
      commit: async () => {
        try {
          for (const op of operations) {
            switch (op.type) {
              case 'set':
                sqliteService.setDoc(op.path, op.data, op.options?.merge || false);
                break;
              case 'update': {
                // Use set-merge if doc doesn't exist to avoid errors
                try {
                  sqliteService.updateDoc(op.path, op.data);
                } catch {
                  sqliteService.setDoc(op.path, op.data, false);
                }
                break;
              }
              case 'delete':
                sqliteService.deleteDoc(op.path);
                break;
            }
          }
          console.log(`[DB Compat] Batch committed ${operations.length} operations`);
        } catch (error) {
          console.error('[DB Compat] Batch commit failed:', error);
          throw error;
        }
      }
    };
  }

  // Map old db.list() calls to new sqlite-service
  list(collectionPath: string): any[] {
    try {
      const result = sqliteService.getCollection(collectionPath);
      return result.docs.map(doc => ({
        id: doc.id,
        data: { ...doc }
      }));
    } catch (error) {
      console.error(`[DB Compat] list(${collectionPath}) failed:`, error);
      return [];
    }
  }
}

// Create singleton instance
const compatDb = new DatabaseCompatibilityLayer();

// Export as both named export and default
export const db = compatDb;
export default compatDb;

// Also export ensureDb function for compatibility
export async function ensureDb() {
  // No-op since sqlite-service handles initialization
  return Promise.resolve();
}
