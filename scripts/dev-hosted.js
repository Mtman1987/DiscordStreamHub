const { spawn } = require('child_process');
const path = require('path');

/**
 * Runs a slimmed-down dev server that only launches the Next.js API/UI so
 * local Puppeteer + FFmpeg flows can run while the production site stays
 * on Firebase App Hosting.
 */

const projectRoot = path.join(__dirname, '..');
const port = process.env.HOSTED_DEV_PORT || process.env.PORT || '3300';

// If the user provided the hosted App URL, reuse it for all "base URL" vars.
const hostedUrl = process.env.HOSTED_APP_URL?.replace(/\/$/, '');
const env = {
  ...process.env,
  COSMICRAID_HOSTED_DEV: '1',
  PORT: port,
};

if (hostedUrl) {
  if (!env.NEXT_PUBLIC_BASE_URL) env.NEXT_PUBLIC_BASE_URL = hostedUrl;
  if (!env.NEXT_PUBLIC_APP_URL) env.NEXT_PUBLIC_APP_URL = hostedUrl;
  if (!env.POINTS_API_URL && hostedUrl) {
    env.POINTS_API_URL = `${hostedUrl}/api/points/update`;
  }
}

console.log(`dYs? Starting hosted dev worker on port ${port}`);
if (hostedUrl) {
  console.log(`Using hosted base URL: ${hostedUrl}`);
}

const nextProc = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'dev', '--port', port],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
    shell: true,
  }
);

const shutdown = () => {
  console.log('\ndY>` Shutting down hosted dev worker...');
  nextProc.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

nextProc.on('exit', (code) => {
  console.log(`Hosted dev worker exited with code ${code ?? '0'}`);
});
