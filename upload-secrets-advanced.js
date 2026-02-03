const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read the .env file
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

console.log(`Found ${Object.keys(envVars).length} environment variables to upload`);

// Function to upload a single secret
function uploadSecret(key, value) {
  return new Promise((resolve) => {
    const child = spawn('firebase', ['functions:secrets:set', key], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
      shell: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        code
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: error.message
      });
    });

    // Send the value to stdin
    child.stdin.write(value);
    child.stdin.end();
  });
}

// Upload secrets with rate limiting
async function uploadAllSecrets() {
  let successCount = 0;
  let failCount = 0;
  const failed = [];

  console.log('\nUploading secrets to Firebase...\n');

  for (const [key, value] of Object.entries(envVars)) {
    process.stdout.write(`Uploading ${key}... `);
    
    const result = await uploadSecret(key, value);
    
    if (result.success) {
      console.log('✅ Success');
      successCount++;
    } else {
      console.log('❌ Failed');
      const errorMsg = result.error || result.stderr || 'Unknown error';
      console.log(`   Error: ${errorMsg}`);
      failed.push({ key, error: errorMsg });
      failCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Upload Summary:`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);

  if (failed.length > 0) {
    console.log('\nFailed uploads:');
    failed.forEach(({ key, error }) => {
      console.log(`  - ${key}: ${error}`);
    });
    
    console.log('\nRetry failed uploads? (y/n)');
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('', async (answer) => {
      if (answer.toLowerCase() === 'y') {
        console.log('\nRetrying failed uploads...\n');
        for (const { key } of failed) {
          process.stdout.write(`Retrying ${key}... `);
          const result = await uploadSecret(key, envVars[key]);
          console.log(result.success ? '✅ Success' : '❌ Failed');
        }
      }
      rl.close();
    });
  }

  console.log('\n' + '='.repeat(50));
  console.log('Done! Your secrets are now available in Firebase Secret Manager.');
  console.log('You can view them in the Firebase Console under Functions > Secrets.');
}

// Check if Firebase CLI is available
function checkFirebaseCLI() {
  return new Promise((resolve) => {
    const child = spawn('firebase', ['--version'], { stdio: 'pipe', shell: true });
    child.on('close', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}

// Main execution
async function main() {
  console.log('Checking Firebase CLI...');
  const hasFirebase = await checkFirebaseCLI();
  
  if (!hasFirebase) {
    console.log('❌ Firebase CLI not found. Please install it first:');
    console.log('   npm install -g firebase-tools');
    console.log('   firebase login');
    return;
  }

  console.log('✅ Firebase CLI found');
  await uploadAllSecrets();
}

main().catch(console.error);