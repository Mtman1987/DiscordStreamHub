
import admin from 'firebase-admin';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage, Storage } from 'firebase-admin/storage';
import * as fs from 'fs';
import * as path from 'path';

let db: Firestore;
let auth: Auth;
let storage: Storage;
let app: admin.app.App;

try {
  if (!admin.apps.length) {
    console.log('[Firebase Admin] Initializing SDK...');
    
    // Try environment variable first (for production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'studio-9468926194-e03ac',
        storageBucket: 'studio-9468926194-e03ac.firebasestorage.app'
      });
      console.log('[Firebase Admin] Initialized with environment variable.');
    } 
    // Fall back to service account file (for local dev)
    else {
      const keyPath = path.resolve(process.cwd(), 'studio-9468926194-e03ac-firebase-adminsdk-fbsvc-28f637ffb4.json');
      
      if (!fs.existsSync(keyPath)) {
        throw new Error(`Service account key not found. Set FIREBASE_SERVICE_ACCOUNT env var or place file at: ${keyPath}`);
      }

      const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'studio-9468926194-e03ac',
        storageBucket: 'studio-9468926194-e03ac.firebasestorage.app'
      });
      console.log('[Firebase Admin] Initialized with service account file.');
    }
  }
  
  app = admin.app();
  db = getFirestore();
  auth = getAuth();
  storage = getStorage();

} catch (error) {
  console.error('[Firebase Admin] CRITICAL: SDK initialization failed.', error);
  // Create dummy objects to prevent the app from crashing on import.
  // Any calls will fail, but this surfaces the init error clearly.
  db = {} as Firestore;
  auth = {} as Auth;
  storage = {} as Storage;
  app = {} as admin.app.App;
}

export { db, auth, storage, app };
