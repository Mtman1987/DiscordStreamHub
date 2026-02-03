#!/usr/bin/env node

/**
 * Usage:
 *   node scripts/store-service-account.js path/to/serviceAccount.json
 *
 * Writes the base64-encoded JSON into the Firestore document configured by
 * FIREBASE_SERVICE_ACCOUNT_DOC_PATH (defaults to infrastructure/credentials/adminServiceAccount)
 * under field FIREBASE_SERVICE_ACCOUNT_DOC_FIELD (defaults to serviceAccountBase64).
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/store-service-account.js path/to/serviceAccount.json');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Service account file not found: ${resolvedPath}`);
  }

  const serviceAccountDoc =
    process.env.FIREBASE_SERVICE_ACCOUNT_DOC_PATH ||
    'infrastructure/credentials/adminServiceAccount';
  const serviceAccountField =
    process.env.FIREBASE_SERVICE_ACCOUNT_DOC_FIELD || 'serviceAccountBase64';

  const base64 = Buffer.from(fs.readFileSync(resolvedPath, 'utf8'), 'utf8').toString('base64');

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    requireEnv('GOOGLE_CLOUD_PROJECT');

  const firebaseApp = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(require(resolvedPath)),
        projectId,
      });

  const db = firebaseApp.firestore();
  await db.doc(serviceAccountDoc).set(
    {
      [serviceAccountField]: base64,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  console.log(`Stored service account base64 into ${serviceAccountDoc}.${serviceAccountField}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
