const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read .env file
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

// Parse environment variables
const envVars = {};
const lines = envContent.split('\n');

for (const line of lines) {
  const trimmedLine = line.trim();
  if (trimmedLine && !trimmedLine.startsWith('#')) {
    const equalIndex = trimmedLine.indexOf('=');
    if (equalIndex > 0) {
      const key = trimmedLine.substring(0, equalIndex).trim();
      const value = trimmedLine.substring(equalIndex + 1).trim();
      if (key && value) {
        envVars[key] = value;
      }
    }
  }
}

console.log(`📤 Uploading ${Object.keys(envVars).length} secrets to Google Secret Manager for project studio-9468926194-e03ac...\n`);

let successCount = 0;
let errorCount = 0;

for (const [key, value] of Object.entries(envVars)) {
  try {
    console.log(`Setting secret: ${key}`);
    // Use echo to pipe the value to firebase secrets set
    execSync(`echo "${value.replace(/"/g, '\\"')}" | firebase functions:secrets:set ${key} --project studio-9468926194-e03ac`, {
      stdio: 'inherit',
      cwd: __dirname
    });
    successCount++;
    console.log(`✅ ${key} set successfully`);
  } catch (error) {
    console.error(`❌ Failed to set ${key}:`, error.message);
    errorCount++;
  }
}

console.log(`\n📊 Results:`);
console.log(`   ✅ Successfully set: ${successCount}`);
console.log(`   ❌ Failed: ${errorCount}`);
console.log(`   📝 Total in .env: ${Object.keys(envVars).length}`);

if (errorCount > 0) {
  console.log('\n❌ Some secrets failed to upload. Check the errors above.');
} else {
  console.log('\n🎉 All secrets uploaded successfully!');
}
