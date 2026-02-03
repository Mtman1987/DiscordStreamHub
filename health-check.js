#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Cosmic Raid Health Check\n');

// Check environment variables
console.log('📋 Environment Variables:');
const requiredEnvVars = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET', 
  'FREE_CONVERT_API_KEY',
  'SHOTSTACK_API_KEY',
  'HARDCODED_GUILD_ID',
  'GEMINI_API_KEY'
];

const envPath = path.join(__dirname, '.env');
let envVars = {};

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      envVars[key.trim()] = value.trim();
    }
  });
}

requiredEnvVars.forEach(varName => {
  const value = envVars[varName] || process.env[varName];
  const status = value ? '✅' : '❌';
  const display = value ? (value.length > 20 ? value.substring(0, 20) + '...' : value) : 'Missing';
  console.log(`  ${status} ${varName}: ${display}`);
});

// Check key files
console.log('\n📁 Key Files:');
const keyFiles = [
  'src/lib/twitch-api-service.ts',
  'src/lib/gif-conversion-service.ts', 
  'src/lib/polling-service.ts',
  'src/lib/community-shoutout-service.ts',
  'src/app/api/polling/route.ts',
  'src/app/(app)/settings/_components/twitch-polling-settings.tsx'
];

keyFiles.forEach(filePath => {
  const fullPath = path.join(__dirname, filePath);
  const exists = fs.existsSync(fullPath);
  const status = exists ? '✅' : '❌';
  console.log(`  ${status} ${filePath}`);
});

// Check package.json dependencies
console.log('\n📦 Dependencies:');
const packagePath = path.join(__dirname, 'package.json');
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const requiredDeps = [
    'firebase',
    'firebase-admin',
    'genkit',
    '@genkit-ai/google-genai',
    'node-fetch'
  ];
  
  requiredDeps.forEach(dep => {
    const version = pkg.dependencies?.[dep] || pkg.devDependencies?.[dep];
    const status = version ? '✅' : '❌';
    console.log(`  ${status} ${dep}: ${version || 'Missing'}`);
  });
} else {
  console.log('  ❌ package.json not found');
}

// Check Firebase config
console.log('\n🔥 Firebase Configuration:');
const firebaseConfigPath = path.join(__dirname, 'src/firebase/config.ts');
if (fs.existsSync(firebaseConfigPath)) {
  console.log('  ✅ Firebase config file exists');
  
  const firebaseEnvVars = [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID'
  ];
  
  firebaseEnvVars.forEach(varName => {
    const value = envVars[varName] || process.env[varName];
    const status = value ? '✅' : '❌';
    console.log(`  ${status} ${varName}: ${value ? 'Set' : 'Missing'}`);
  });
} else {
  console.log('  ❌ Firebase config file missing');
}

// Check Space Mountain integration
console.log('\n🏔️ Space Mountain Integration:');
const spaceMountainScript = path.join(__dirname, 'scripts/space-mountain-client.js');
const launcherInstall = path.join(__dirname, '.launcher-install.json');

console.log(`  ${fs.existsSync(spaceMountainScript) ? '✅' : '❌'} Space Mountain client script`);
console.log(`  ${fs.existsSync(launcherInstall) ? '✅' : '❌'} Launcher install config`);

// Recommendations
console.log('\n💡 Recommendations:');
console.log('1. Ensure all environment variables are properly set in .env file');
console.log('2. Run "npm install" to install missing dependencies');
console.log('3. Test Twitch API connection in settings page');
console.log('4. Start polling service to begin monitoring streams');
console.log('5. Check Firebase connection and permissions');

// Quick fixes
console.log('\n🔧 Quick Fixes:');
console.log('• Missing Twitch credentials? Get them from https://dev.twitch.tv/console');
console.log('• Missing FreeConvert API? Sign up at https://www.freeconvert.com/api');
console.log('• Missing Shotstack API? Sign up at https://shotstack.io');
console.log('• Firebase issues? Check your service account key path');

console.log('\n🎯 Next Steps:');
console.log('1. Fix any ❌ issues above');
console.log('2. Run: npm run dev');
console.log('3. Go to Settings → Twitch Polling Settings');
console.log('4. Enable automatic polling');
console.log('5. Test shoutout generation');

console.log('\n✨ Cosmic Raid should now work properly with:');
console.log('• Real-time Twitch stream monitoring');
console.log('• Automatic GIF conversion from clips');
console.log('• Enhanced shoutouts with live data');
console.log('• Community spotlight with rotating clips');
