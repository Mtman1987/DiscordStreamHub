const { spawn, execSync } = require('child_process');
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

// Function to get existing secrets
function getExistingSecrets() {
  try {
    const result = execSync('firebase functions:secrets:access --list', {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: __dirname
    });
    
    const secrets = [];
    const lines = result.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.includes('Secret') && !trimmed.includes('---')) {
        const secretName = trimmed.split(/\s+/)[0];
        if (secretName) {
          secrets.push(secretName);
        }
      }
    }
    return secrets;
  } catch (error) {
    console.log('Could not fetch existing secrets, will attempt to upload all');
    return [];
  }
}

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

async function main() {
  console.log('🔍 Checking existing secrets...');
  const existingSecrets = getExistingSecrets();
  console.log(`Found ${existingSecrets.length} existing secrets`);

  const allKeys = Object.keys(envVars);
  const missingSecrets = allKeys.filter(key => !existingSecrets.includes(key));
  
  console.log(`\n📊 Status:`);
  console.log(`   Total secrets in .env: ${allKeys.length}`);
  console.log(`   Already uploaded: ${existingSecrets.length}`);
  console.log(`   Missing/Failed: ${missingSecrets.length}`);

  if (missingSecrets.length === 0) {
    console.log('\n✅ All secrets are already uploaded!');
    return;
  }

  console.log(`\n🔄 Uploading ${missingSecrets.length} missing secrets...\n`);

  let successCount = 0;
  let failCount = 0;
  const failed = [];

  for (const key of missingSecrets) {
    process.stdout.write(`Uploading ${key}... `);
    
    const result = await uploadSecret(key, envVars[key]);
    
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
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📈 Upload Results:`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);

  if (failed.length > 0) {
    console.log('\n❌ Failed uploads:');
    failed.forEach(({ key, error }) => {
      console.log(`   - ${key}: ${error}`);
    });

    // Offer to retry with different approach
    console.log('\n🔄 Trying alternative upload method for failed secrets...\n');
    
    for (const { key } of failed) {
      process.stdout.write(`Retrying ${key} with echo method... `);
      
      try {
        // Try using echo to pipe the value
        const command = `echo ${envVars[key]} | firebase functions:secrets:set ${key}`;
        execSync(command, {
          stdio: 'pipe',
          cwd: __dirname,
          shell: true
        });
        console.log('✅ Success');
        successCount++;
        failCount--;
      } catch (error) {
        console.log('❌ Still failed');
        console.log(`   Error: ${error.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`🎉 Final Results:`);
  console.log(`   ✅ Total Successful: ${successCount}`);
  console.log(`   ❌ Total Failed: ${failCount}`);
  console.log('\n🔗 View your secrets at:');
  console.log('   https://console.firebase.google.com/project/studio-5587063777-d2e6c/functions/secrets');
}

main().catch(console.error);