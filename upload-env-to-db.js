require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

// Initialize Firebase Admin
// Use the database project credentials but target the hosting project
const serviceAccount = JSON.parse(fs.readFileSync('./studio-9468926194-e03ac-firebase-adminsdk-fbsvc-75298e056b.json', 'utf8'));
serviceAccount.project_id = 'studio-5587063777-d2e6c'; // Override to hosting project
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: 'studio-5587063777-d2e6c'
});

const db = getFirestore(app);

async function uploadEnvToDb() {
  const serverId = process.env.HARDCODED_GUILD_ID || '1240832965865635881';
  
  console.log(`📤 Uploading .env variables to Firestore for server: ${serverId}`);
  
  // Get only the app-specific environment variables
  const appVars = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    DISCORD_APP_ID: process.env.DISCORD_APP_ID,
    DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY,
    FREE_CONVERT_API_KEY: process.env.FREE_CONVERT_API_KEY,
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    TWITCH_BOT_TOKEN: process.env.TWITCH_BOT_OAUTH_TOKEN,
    TWITCH_BROADCASTER_ID: process.env.TWITCH_BROADCASTER_ID,
    TWITCH_BROADCASTER_USERNAME: process.env.TWITCH_BROADCASTER_USERNAME,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    SHOTSTACK_API_KEY: process.env.SHOTSTACK_API_KEY,
    GUILD_ID: process.env.GUILD_ID,
    HARDCODED_GUILD_ID: process.env.HARDCODED_GUILD_ID,
    DISCORD_SHOUTOUT_CHANNEL_ID: process.env.DISCORD_SHOUTOUT_CHANNEL_ID,
    DISCORD_VIP_CHANNEL_ID: process.env.DISCORD_VIP_CHANNEL_ID
  };
  
  // Remove undefined values
  Object.keys(appVars).forEach(key => {
    if (!appVars[key]) delete appVars[key];
  });
  
  try {
    const docRef = db.collection('servers').doc(serverId).collection('config').doc('secrets');
    
    console.log('🔍 Checking if document exists...');
    const doc = await docRef.get();
    console.log('Document exists:', doc.exists);
    
    console.log('💾 Writing to Firestore...');
    await docRef.set(appVars, { merge: true });
    
    console.log('✅ Verifying upload...');
    const verifyDoc = await docRef.get();
    console.log('Verification - Document exists:', verifyDoc.exists);
    console.log('Verification - Data keys:', Object.keys(verifyDoc.data() || {}));
    
    console.log(`✅ Successfully uploaded ${Object.keys(appVars).length} app variables`);
    console.log('📋 Uploaded variables:');
    Object.keys(appVars).forEach(key => {
      const value = appVars[key];
      const displayValue = value && value.length > 20 ? value.substring(0, 20) + '...' : value;
      console.log(`  ${key}: ${displayValue}`);
    });
    
  } catch (error) {
    console.error('❌ Error uploading to Firestore:', error);
    console.error('Error details:', error.message);
  }
}

uploadEnvToDb().then(() => {
  console.log('\n🎉 Upload complete!');
  setTimeout(() => process.exit(0), 1000); // Give time for async operations
}).catch(error => {
  console.error('💥 Fatal error:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});