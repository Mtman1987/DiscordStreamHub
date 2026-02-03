
import admin from 'firebase-admin';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import * as fs from 'fs';
import * as path from 'path';

let db: Firestore;
let auth: Auth;

try {
  if (!admin.apps.length) {
    console.log('[Firebase Admin] Initializing SDK with service account...');
    
    // Construct the absolute path to the service account key in the project root
    const keyPath = path.resolve(process.cwd(), 'studio-9468926194-e03ac-firebase-adminsdk-fbsvc-75298e056b.json');
    
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Service account key not found at: ${keyPath}`);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    
    // Initialize with the explicit service account credential
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'studio-9468926194-e03ac', // Explicitly use the database project ID
    });
    
    console.log('[Firebase Admin] SDK initialized successfully with service account credential.');
  }
  
  db = getFirestore();
  auth = getAuth();

} catch (error) {
  console.error('[Firebase Admin] CRITICAL: SDK initialization failed.', error);
  // Create dummy objects to prevent the app from crashing on import.
  // Any calls will fail, but this surfaces the init error clearly.
  db = {} as Firestore;
  auth = {} as Auth;
}

export { db, auth };
export const app = admin.app();
