const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting CosmicRaid...');

// Check if node_modules exists
const hasNodeModules = fs.existsSync(path.join(__dirname, 'node_modules'));

if (hasNodeModules) {
  startCosmicRaid();
} else {
  console.log('📦 Installing CosmicRaid dependencies...');
  const install = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });
  
  install.on('exit', (code) => {
    if (code === 0) {
      console.log('✅ Dependencies installed, starting CosmicRaid...');
      startCosmicRaid();
    } else {
      console.error('❌ Dependency install failed, trying npm fallback...');
      fallbackStart();
    }
  });
}

function startCosmicRaid() {
  try {
    // Start Space Mountain client
    const smClient = spawn('node', ['scripts/space-mountain-client.js'], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    // Start Next.js dev server
    const nextServer = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', '3001'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });

    const shutdown = () => {
      console.log('\n🛑 Shutting down CosmicRaid...');
      smClient.kill();
      nextServer.kill();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('❌ CosmicRaid startup script failed:', error.message);
    fallbackStart();
  }
}

function fallbackStart() {
  console.log('⚠️  Using npm fallback for CosmicRaid...');
  const fallback = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });
  
  fallback.on('exit', (code) => {
    console.log(`CosmicRaid fallback exited with code ${code}`);
  });
}