
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin - Use App Hosting project
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'studio-5587063777-d2e6c'
});

const db = admin.firestore();

async function uploadSecrets() {
  try {
    // Read .env file
    const envPath = path.join(__dirname, '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    // Parse .env content
    const secrets = {};
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          secrets[key.trim()] = valueParts.join('=').trim();
        }
      }
    });

    // Upload to Firestore: servers/1240832965865635881/config/secrets
    const serverId = process.env.HARDCODED_GUILD_ID || '1240832965865635881'; // Your guild ID from .env
    await db.collection('servers').doc(serverId).collection('config').doc('secrets').set(secrets);
    
    console.log(`✅ Uploaded ${Object.keys(secrets).length} secrets to servers/${serverId}/config/secrets`);
    console.log('Keys uploaded:', Object.keys(secrets).sort());
    
  } catch (error) {
    console.error('❌ Error uploading secrets:', error);
  }
  
  process.exit(0);
}

uploadSecrets();
